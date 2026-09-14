import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { readPersonaLicence, guardPersonaPath, withPersonaMutationLock, personaAccessDenialPath, readPersonaAccessDenial, writePrivatePersonaJson } from './persona-licence-config.mjs';
import { DEFAULT_PERSONA_SERVER, personaServer, websitePersonaStatus, acquireWebsitePersonaArchive } from './persona-website-provider.mjs';
import { extractPersonaZip } from './persona-zip.mjs';

export const DEFAULT_PREMIUM_UPGRADE_URL = 'https://www.conversationalcoding.dev/personas/';
export const PREMIUM_PACK_ID = 'ewai.personas.professional';
export const PERSONA_ENTITLEMENT_SCHEMA = 'ewai.persona-entitlement/v1';
export const PERSONA_PACK_RECEIPT_SCHEMA = 'ewai.persona-pack-receipt/v1';

export const PERSONA_PACK_LIMITS = Object.freeze({
  maxFiles: 1000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
});

const allowedExtensions = new Set(['.csv', '.json', '.md', '.markdown', '.txt', '.yaml', '.yml']);
const allowedExtensionless = new Set(['license', 'notice', 'readme']);
const revisionPattern = /^[a-f0-9]{64}$/;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function clean(value) {
  return String(value ?? '').trim();
}

function isWithin(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || Boolean(rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function safeRelativePath(value, label) {
  const path = clean(value).replaceAll('\\', '/');
  if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return path;
}

export function resolvePersonaEntitlement(config = {}, options = {}) {
  const configured = config.personas?.premium ?? config.premium ?? config;
  if (configured.provider && configured.provider !== 'wordpress-edd'
    || ['repository', 'branch', 'upgrade_url', 'upgradeUrl'].some(key => Object.hasOwn(configured, key))) {
    throw new Error('Premium personas use website licences only. Remove obsolete persona source fields and run ewai persona premium configure --project .');
  }
  const saved = readPersonaLicence(options.home ?? homedir());
  return {
    id: PREMIUM_PACK_ID, provider: 'wordpress-edd',
    server: personaServer(configured.server || saved?.server || DEFAULT_PERSONA_SERVER),
    upgradeUrl: DEFAULT_PREMIUM_UPGRADE_URL,
  };
}

export function premiumPackRoot(home = homedir()) {
  return resolve(home, '.ewai/packs', PREMIUM_PACK_ID);
}

export function premiumPersonaRoot(home = homedir()) {
  try {
    const receipt = readReceipt(home);
    if (!receipt || receiptDeniesAccess(receipt, home)) return '';
  } catch {
    // An unsafe receipt is not a route into content via another persona caller.
    return '';
  }
  return resolve(premiumPackRoot(home), 'premium-personas');
}

export function premiumPackReceiptPath(home = homedir()) {
  return resolve(home, '.ewai/packs/.receipts', `${PREMIUM_PACK_ID}.json`);
}

function parseManifest(root, expectedPackId) {
  const path = resolve(root, 'pack.yaml');
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error('Persona pack is missing pack.yaml');
  if (lstatSync(path).size > PERSONA_PACK_LIMITS.maxFileBytes) throw new Error('Persona pack manifest exceeds the maximum size');
  let manifest;
  try {
    manifest = YAML.parse(readFileSync(path, 'utf8'), { maxAliasCount: 0 });
  } catch {
    throw new Error('Persona pack manifest is not valid YAML');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Persona pack manifest must be an object');
  }
  const personaPath = safeRelativePath(manifest.content?.personas, 'Persona pack content.personas');
  if (manifest.schema === undefined) {
    return { raw: manifest, packId: expectedPackId, manifestVersion: null, personaPath, compatibility: 'compatible-legacy' };
  }
  const richPersonaPack = manifest.schema === 'ewai.pack/v1' && manifest.type === 'persona';
  if (manifest.schema !== 'ewai.persona-pack/v1' && !richPersonaPack) throw new Error('Persona pack schema is unsupported');
  if (clean(manifest.id) !== expectedPackId) throw new Error(`Persona pack id must be ${expectedPackId}`);
  if (!semverPattern.test(clean(manifest.version))) throw new Error('Persona pack version must be semantic version text');
  const allowed = new Set(['schema', 'id', 'version', 'content']);
  if (richPersonaPack) {
    // Source-library metadata is inert. Never allow commands, skills, deployment
    // or nonempty boilerplates through this persona-only delivery boundary.
    for (const key of ['name', 'type', 'description', 'commercial', 'source', 'updates', 'compatibility', 'normalisation_status', 'boilerplates']) allowed.add(key);
    if (typeof manifest.name !== 'string' || !manifest.name.trim()
      || manifest.boilerplates !== undefined && (!Array.isArray(manifest.boilerplates) || manifest.boilerplates.length)) throw new Error('Persona source pack contains unsupported material');
  }
  if (Object.keys(manifest).some((key) => !allowed.has(key))) throw new Error('Persona pack manifest contains unsupported fields');
  if (!manifest.content || typeof manifest.content !== 'object' || Array.isArray(manifest.content)
    || Object.keys(manifest.content).some((key) => key !== 'personas')) {
    throw new Error('Persona pack content must contain only personas');
  }
  return { raw: manifest, packId: expectedPackId, manifestVersion: clean(manifest.version), personaPath, compatibility: 'current' };
}

function allowedFile(path) {
  const extension = extname(path).toLowerCase();
  if (extension) return allowedExtensions.has(extension);
  return allowedExtensionless.has(basename(path).toLowerCase());
}

function collectPackFiles(root, limits) {
  const files = [];
  let totalBytes = 0;
  function visit(folder, relativeFolder = '') {
    for (const name of readdirSync(folder).sort((left, right) => left.localeCompare(right))) {
      if (name.startsWith('.')) throw new Error('Persona packs may not contain hidden metadata');
      const absolute = resolve(folder, name);
      if (!isWithin(root, absolute)) throw new Error('Persona pack path escapes its root');
      const relativePath = relativeFolder ? `${relativeFolder}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Persona packs may not contain symbolic links: ${relativePath}`);
      if (stat.isDirectory()) {
        visit(absolute, relativePath);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Persona packs may contain regular files only: ${relativePath}`);
      if (!allowedFile(relativePath)) throw new Error(`Persona pack file type is not allowed: ${relativePath}`);
      if (stat.size > limits.maxFileBytes) throw new Error(`Persona pack file exceeds the maximum size: ${relativePath}`);
      totalBytes += stat.size;
      if (totalBytes > limits.maxTotalBytes) throw new Error('Persona pack exceeds the maximum total size');
      files.push({ absolute, relativePath, size: stat.size });
      if (files.length > limits.maxFiles) throw new Error('Persona pack exceeds the maximum file count');
    }
  }
  visit(root);
  return { files, totalBytes };
}

function contentDigest(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath, 'utf8');
    hash.update('\0');
    hash.update(String(file.size), 'utf8');
    hash.update('\0');
    hash.update(readFileSync(file.absolute));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function validatePersonaPack(root, options = {}) {
  const candidate = resolve(root);
  if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) throw new Error('Persona pack candidate is not a directory');
  const packId = clean(options.packId || PREMIUM_PACK_ID);
  const providerId = clean(options.providerId || 'wordpress-edd');
  if (providerId !== 'wordpress-edd') throw new Error('Persona pack provider must use website licences');
  const revision = clean(options.revision);
  if (!revisionPattern.test(revision)) throw new Error('Persona pack revision is invalid');
  const manifest = parseManifest(candidate, packId);
  const personaRoot = resolve(candidate, manifest.personaPath);
  if (!isWithin(candidate, personaRoot) || !existsSync(personaRoot) || !lstatSync(personaRoot).isDirectory()) {
    throw new Error('Persona pack is missing its declared persona directory');
  }
  const collected = collectPackFiles(candidate, { ...PERSONA_PACK_LIMITS, ...(options.limits ?? {}) });
  const personaFiles = collected.files.filter((file) => file.relativePath.startsWith(`${manifest.personaPath}/`));
  if (!personaFiles.length) throw new Error('Persona pack declared persona directory is empty');
  return {
    packId,
    providerId,
    revision,
    manifestVersion: manifest.manifestVersion,
    compatibility: manifest.compatibility,
    personaPath: manifest.personaPath,
    contentDigest: contentDigest(collected.files),
    fileCount: collected.files.length,
    totalBytes: collected.totalBytes,
  };
}

function readReceipt(home) {
  const path = premiumPackReceiptPath(home);
  guardPersonaPath(home, path);
  if (!existsSync(path)) return null;
  try {
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    if (receipt.schema !== PERSONA_PACK_RECEIPT_SCHEMA
      || receipt.packId !== PREMIUM_PACK_ID
      || receipt.providerId !== 'wordpress-edd'
      || !revisionPattern.test(clean(receipt.revision))
      || !/^sha256:[a-f0-9]{64}$/.test(clean(receipt.contentDigest))) return null;
    return receipt;
  } catch {
    return null;
  }
}

function atomicReceipt(home, receipt) {
  const path = premiumPackReceiptPath(home);
  guardPersonaPath(home, path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export async function inspectPersonaEntitlement(config = {}, options = {}) {
  let configuration;
  try { configuration = resolvePersonaEntitlement(config, options); }
  catch (error) {
    const configured = config.personas?.premium ?? config.premium ?? config;
    if (configured.provider && configured.provider !== 'wordpress-edd'
      || ['repository', 'branch', 'upgrade_url', 'upgradeUrl'].some(key => Object.hasOwn(configured, key))) throw error;
    return websiteSafeStatus({ id: PREMIUM_PACK_ID, provider: 'wordpress-edd' }, { installed: existsSync(premiumPackRoot(options.home ?? homedir())) }, null, 'private-config-unavailable');
  }
  return inspectWebsitePack(configuration, options);
}

function receiptFor(verified, now = new Date().toISOString()) {
  return {
    schema: PERSONA_PACK_RECEIPT_SCHEMA,
    packId: verified.packId,
    providerId: verified.providerId,
    manifestVersion: verified.manifestVersion,
    revision: verified.revision,
    contentDigest: verified.contentDigest,
    compatibility: verified.compatibility,
    verifiedAt: now,
  };
}

export async function syncPersonaPack(config = {}, options = {}) {
  if (options.confirmed !== true) throw new Error('Premium persona downloads require explicit confirmation; pass --yes after the user agrees');
  return syncWebsitePack(resolvePersonaEntitlement(config, options), options);
}

export function readPremiumPackManifest(home = homedir()) {
  const path = resolve(premiumPackRoot(home), 'pack.yaml');
  return existsSync(path) ? YAML.parse(readFileSync(path, 'utf8'), { maxAliasCount: 0 }) : null;
}

async function websiteLocal(home) {
  if (!existsSync(home)) return { installed: false, verified: false, receipt: null, validation: null, dirty: false };
  const root = guardPersonaPath(home, premiumPackRoot(home));
  if (!existsSync(root)) return { installed: false, verified: false, receipt: null, validation: null, dirty: false };
  const receipt = readReceipt(home);
  let validation = null;
  if (receipt?.providerId === 'wordpress-edd' && lstatSync(root).isDirectory() ) {
    try { validation = validatePersonaPack(root, { providerId: 'wordpress-edd', revision: receipt.revision }); } catch {}
  }
  const verified = Boolean(validation && validation.contentDigest === receipt.contentDigest
    && validation.manifestVersion === receipt.manifestVersion && validation.compatibility === receipt.compatibility
    && receipt.provenance?.server && receipt.provenance?.seatId && receipt.provenance?.subscriptionId
    && ['team', 'individual'].includes(receipt.provenance.planType));
  return { installed: true, receipt, validation, verified, dirty: !verified, accessBlocked: receiptDeniesAccess(receipt, home) };
}

function receiptDeniesAccess(receipt, home) {
  if (receipt?.providerId !== 'wordpress-edd' || receipt.provenance?.planType !== 'team') return false;
  if (receipt.accessBlocked === 'expired-team') return true;
  try {
    const denied = readPersonaAccessDenial(home);
    return denied?.schema === 'ewai.persona-access-denial/v1' && denied.installationId === receipt.installationId
      && denied.server === receipt.provenance.server && denied.seatId === receipt.provenance.seatId
      && denied.subscriptionId === receipt.provenance.subscriptionId;
  } catch { return true; }
}

function receiptMatches(receipt, remote) {
  const p = receipt?.provenance;
  return receipt?.providerId === 'wordpress-edd' && p?.server === remote?.server
    && p?.seatId === remote?.seatId && p?.subscriptionId === remote?.subscription.id
    && p?.planType === remote?.subscription.planType;
}

function websiteSafeStatus(configuration, local, remote, reason = null) {
  const access = remote?.access ?? 'unknown';
  const expired = remote?.subscription.status === 'expired';
  const matches = receiptMatches(local.receipt, remote);
  const accessBlocked = local.accessBlocked || local.receipt?.accessBlocked === 'expired-team';
  const status = accessBlocked && access !== 'available' ? 'expired-team-cleanup-blocked'
    : accessBlocked ? 'installed-unverified'
    : expired && matches && remote.subscription.planType === 'individual'
    ? 'expired-individual-retained'
    : !local.installed ? 'not-installed' : !local.verified ? 'installed-unverified'
      : access !== 'available' ? 'installed-not-remotely-verified'
        : matches && local.receipt.revision === remote.release.sha256 && local.receipt.manifestVersion === remote.release.version ? 'current' : 'update-available';
  let action = null;
  if (reason === 'licence-not-configured') action = { kind: 'offer-configure', prompt: 'Have a persona licence? Configure it using the private terminal prompt.', command: 'ewai persona premium configure --project .' };
  else if (access === 'available') {
    const command = 'ewai persona premium sync --project . --yes';
    if (local.dirty) action = { kind: 'blocked-local-changes', prompt: 'The managed premium pack has changed locally. Resolve those changes before replacing it.', command: null };
    else if (!local.installed) action = { kind: 'offer-install', prompt: 'Install your licensed premium personas?', command };
    else if (!matches) action = { kind: 'offer-replace', prompt: 'This pack belongs to another provider or licence. Explicitly replace it with this subscription?', command: command + ' --replace' };
    else if (!local.verified || accessBlocked) action = { kind: 'offer-repair', prompt: 'Replace the unverified or previously expired pack with a verified download?', command };
    else if (status === 'update-available') action = { kind: 'offer-update', prompt: 'A new persona release is available. Download the update?', command };
  }
  const message = accessBlocked
    ? access === 'available' ? 'Your subscription is available again. Install a verified pack to resume using its premium personas.'
      : 'This team pack has a confirmed expiry. Its modified files were preserved for investigation, but it is excluded from premium persona selection.'
    : status === 'expired-individual-retained'
    ? 'Your annual access has expired. Keep using your installed individual personas; you are no longer receiving updates.'
    : expired ? 'This team subscription has expired. Access to its premium personas has ended.'
      : reason === 'licence-not-configured' ? 'Configure your licence to use website-purchased personas. Core EWAI remains available.'
        : reason ? 'Persona access could not be verified. Check your connection or configure the licence again. Installed content has not been removed.'
          : null;
  return {
    schema: PERSONA_ENTITLEMENT_SCHEMA, packId: PREMIUM_PACK_ID, provider: 'wordpress-edd',
    access, accessReason: reason || (access === 'unavailable' ? 'subscription-' + remote.subscription.status : null),
    status, installed: Boolean(local.installed), verified: Boolean(local.verified && !accessBlocked), dirty: Boolean(local.dirty),
    compatibility: local.validation?.compatibility ?? null, manifestVersion: local.validation?.manifestVersion ?? null,
    version: local.receipt?.manifestVersion ?? null, latestVersion: remote?.release?.version ?? null,
    revision: local.verified ? local.receipt.revision : null, latestRevision: remote?.release?.sha256 ?? null,
    contentDigest: local.verified ? local.validation.contentDigest : null,
    planType: remote?.subscription.planType ?? null, subscriptionStatus: remote?.subscription.status ?? null,
    updatesAvailable: access === 'available' && status === 'update-available',
    upgradeUrl: (access === 'unavailable' || reason === 'licence-not-configured') && !local.installed ? configuration.upgradeUrl : null,
    message, action,
  };
}

async function inspectWebsitePack(configuration, options) {
  const home = options.home ?? homedir();
  let local;
  try { local = await websiteLocal(home); }
  catch { return websiteSafeStatus(configuration, { installed: existsSync(premiumPackRoot(home)) }, null, 'unsafe-local-state'); }
  let remote;
  try {
    const credentials = readPersonaLicence(home);
    if (!credentials) return websiteSafeStatus(configuration, local, null, 'licence-not-configured');
    if (personaServer(credentials.server) !== configuration.server) throw new Error('server mismatch');
    remote = await websitePersonaStatus(credentials, options);
  } catch (e) { return websiteSafeStatus(configuration, local, null, e.code === 'invalid_activation' ? 'invalid-activation' : 'provider-access-unknown'); }
  if (remote.subscription.status === 'expired' && remote.subscription.planType === 'team'
    && local.installed && receiptMatches(local.receipt, remote)) {
    try {
      // Independent access projection is generation-bound: a busy mutation lock
      // must not make a confirmed expired pack eligible for persona selection.
      writePrivatePersonaJson(home, personaAccessDenialPath(home), {
        schema: 'ewai.persona-access-denial/v1', installationId: local.receipt.installationId,
        server: remote.server, seatId: remote.seatId, subscriptionId: remote.subscription.id,
      });
      await withPersonaMutationLock(home, async () => {
        const current = await websiteLocal(home);
        if (current.receipt?.installationId !== local.receipt.installationId) {
          const error = new Error('The installed pack changed during the expiry check');
          error.code = 'local-generation-changed'; throw error;
        }
        if (!receiptMatches(current.receipt, remote)) throw new Error('provenance changed');
        // Persist the known expiry outside the pack before any deletion.
        // Every premium catalogue caller honours it, even after a later outage.
        atomicReceipt(home, { ...current.receipt, accessBlocked: 'expired-team' });
        if (current.dirty || !current.verified) throw new Error('local changes block cleanup');
        const root = guardPersonaPath(home, premiumPackRoot(home));
        const receiptPath = guardPersonaPath(home, premiumPackReceiptPath(home));
        rmSync(root, { recursive: true }); rmSync(receiptPath, { force: true });
      });
      return { ...websiteSafeStatus(configuration, { installed: false, verified: false }, remote),
        status: 'expired-team-removed', message: 'This team subscription has expired. Its managed premium personas were removed; your own personas are unchanged.' };
    } catch (e) {
      if (e.code === 'local-generation-changed') return websiteSafeStatus(configuration, await websiteLocal(home), null, 'local-generation-changed');
      return { ...websiteSafeStatus(configuration, local, remote), status: 'expired-team-cleanup-blocked', verified: false,
      message: 'This team subscription has expired, but safe cleanup could not finish. Resolve the cache issue before using its premium personas.' }; }
  }
  return websiteSafeStatus(configuration, local, remote);
}

async function syncWebsitePack(configuration, options) {
  const home = options.home ?? homedir();
  const credentials = readPersonaLicence(home);
  if (!credentials) throw new Error('Configure your persona licence first: ewai persona premium configure --project .');
  if (personaServer(credentials.server) !== configuration.server) throw new Error('Configured persona server differs from the stored licence; configure it again');
  const remote = await websitePersonaStatus(credentials, options);
  if (remote.access !== 'available') throw new Error(remote.subscription.status === 'expired' ? 'This subscription has expired; persona updates have ended' : 'This subscription is not currently available');
  return withPersonaMutationLock(home, async () => {
    const local = await websiteLocal(home), root = premiumPackRoot(home);
    if (local.dirty) throw new Error('Premium cache has local changes; it was not overwritten');
    if (local.installed && !receiptMatches(local.receipt, remote) && options.replaceConfirmed !== true) throw new Error('This pack belongs to another provider or licence. Confirm replacement separately with --replace');
    if (local.verified && !local.accessBlocked && !local.receipt.accessBlocked && receiptMatches(local.receipt, remote) && local.receipt.revision === remote.release.sha256
      && local.receipt.manifestVersion === remote.release.version && options.forceRepair !== true) {
      return { schema: 'ewai.premium-sync/v1', status: 'current', provider: 'wordpress-edd', version: local.receipt.manifestVersion };
    }
    const stagingRoot = guardPersonaPath(home, resolve(dirname(root), '.staging'));
    mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
    const session = mkdtempSync(resolve(stagingRoot, PREMIUM_PACK_ID + '-'));
    const candidate = resolve(session, 'candidate'); mkdirSync(candidate, { mode: 0o700 });
    const backup = guardPersonaPath(home, resolve(dirname(root), '.' + PREMIUM_PACK_ID + '.backup-' + randomUUID()));
    const receiptPath = guardPersonaPath(home, premiumPackReceiptPath(home));
    const priorReceipt = existsSync(receiptPath) ? readFileSync(receiptPath) : null;
    let backedUp = false, promoted = false;
    try {
      const archive = await acquireWebsitePersonaArchive(credentials, remote, options);
      if (archive.length !== remote.release.size) throw new Error('Persona archive size does not match the release');
      if (createHash('sha256').update(archive).digest('hex') !== remote.release.sha256) throw new Error('Persona archive digest does not match the release');
      extractPersonaZip(archive, candidate);
      // Trust remains in the core verifier, independent of transport/grant success.
      const verified = validatePersonaPack(candidate, { providerId: 'wordpress-edd', revision: remote.release.sha256 });
      if (verified.manifestVersion !== remote.release.version || verified.personaPath !== 'premium-personas' || verified.compatibility !== 'current') throw new Error('Persona archive manifest differs from the release');
      guardPersonaPath(home, root); guardPersonaPath(home, receiptPath);
      if (existsSync(root)) { renameSync(root, backup); backedUp = true; }
      renameSync(candidate, root); promoted = true;
      if (options.failAfterStage === 'candidate-promoted') throw new Error('Injected premium persona promotion failure');
      atomicReceipt(home, { ...receiptFor(verified, options.now), installationId: randomUUID(), provenance: {
        server: remote.server, seatId: remote.seatId, subscriptionId: remote.subscription.id, planType: remote.subscription.planType,
      } });
      if (options.failAfterStage === 'receipt-written') throw new Error('Injected premium persona receipt failure');
      if (backedUp) { rmSync(backup, { recursive: true }); backedUp = false; }
      return { schema: 'ewai.premium-sync/v1', status: local.installed ? 'updated' : 'installed', provider: 'wordpress-edd',
        revision: verified.revision, version: verified.manifestVersion, contentDigest: verified.contentDigest };
    } catch (e) {
      if (promoted) rmSync(guardPersonaPath(home, root), { recursive: true });
      if (backedUp) renameSync(guardPersonaPath(home, backup), root);
      if (priorReceipt) { guardPersonaPath(home, receiptPath); writeFileSync(receiptPath, priorReceipt, { mode: 0o600 }); }
      else rmSync(guardPersonaPath(home, receiptPath), { force: true });
      throw e;
    } finally { rmSync(guardPersonaPath(home, session), { recursive: true }); }
  });
}
