import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  canonicalJson,
  createErrorReportDraft,
  errorReportIdentity,
  finaliseErrorReport,
  reviseErrorReport,
} from '../error-reporting.mjs';
import { atomicJson, isWithin, now, sha256 } from '../delivery-documents.mjs';
import { runtimePaths } from './paths.mjs';

const reportIdPattern = /^report_[a-z0-9_]{3,80}$/;
const adapterIdPattern = /^[a-z][a-z0-9.-]{1,79}$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const manifestFields = new Set(['schema', 'id', 'name', 'publisher', 'version', 'protocolVersion', 'entrypoint']);
const publisherFields = new Set(['id', 'name']);
const acknowledgementFields = new Set(['schema', 'attemptId', 'archiveDigest', 'status', 'externalReference']);
const maxManifestBytes = 64 * 1024;
const maxAdapterFiles = 1024;
const maxAdapterBytes = 64 * 1024 * 1024;
const maxAdapterOutputBytes = 1024 * 1024;
const defaultTimeoutMs = 30_000;

const DEFAULT_SETTINGS = Object.freeze({
  schema: 'ewai.error-report-settings/v1',
  automaticLocalDrafts: false,
  supportEmail: '',
});

function strictFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!fields.has(key)) throw new Error(`${label} contains unknown field: ${key}`);
}

function safeReportId(value) {
  const id = String(value ?? '').trim();
  if (!reportIdPattern.test(id)) throw new Error('Error report id is invalid.');
  return id;
}

function paths(projectRoot) {
  const base = runtimePaths(projectRoot);
  for (const folder of [
    base.errorReportsRoot,
    base.errorReportDraftsRoot,
    base.errorReportPackagesRoot,
    base.errorReportReceiptsRoot,
    base.errorReportArchiveRoot,
    base.errorReportAdaptersRoot,
  ]) mkdirSync(folder, { recursive: true });
  if (!existsSync(base.errorReportSettingsPath)) atomicJson(base.errorReportSettingsPath, DEFAULT_SETTINGS);
  return base;
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function atomicBuffer(path, bytes) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.ewai-${process.pid}-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function draftPath(base, id) {
  return resolve(base.errorReportDraftsRoot, `${safeReportId(id)}.json`);
}

function reportPackageRoot(base, id) {
  return resolve(base.errorReportPackagesRoot, safeReportId(id));
}

function revisionFolder(base, id, revision) {
  if (!Number.isInteger(revision) || revision < 1) throw new Error('Error report revision is invalid.');
  return resolve(reportPackageRoot(base, id), `revision-${revision}`);
}

function latestPackagedReport(base, id) {
  const root = reportPackageRoot(base, id);
  if (!existsSync(root)) return null;
  const revisions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^revision-[1-9][0-9]*$/.test(entry.name))
    .map((entry) => Number(entry.name.slice('revision-'.length)))
    .sort((left, right) => right - left);
  for (const revision of revisions) {
    const report = readJson(resolve(revisionFolder(base, id, revision), 'report.json'));
    if (report) return report;
  }
  return null;
}

function archivedReport(base, id) {
  const root = resolve(base.errorReportArchiveRoot, safeReportId(id));
  if (!existsSync(root)) return null;
  const candidates = readdirSync(root).filter((name) => /^revision-[1-9][0-9]*\.json$/.test(name))
    .sort((left, right) => Number(right.match(/\d+/)[0]) - Number(left.match(/\d+/)[0]));
  return candidates.length ? readJson(resolve(root, candidates[0])) : null;
}

function safeProjection(report) {
  if (!report) return null;
  return JSON.parse(JSON.stringify(report));
}

export function errorReportSettings(projectRoot) {
  const base = paths(projectRoot);
  const settings = readJson(base.errorReportSettingsPath, DEFAULT_SETTINGS);
  strictFields(settings, new Set(['schema', 'automaticLocalDrafts', 'supportEmail']), 'Error report settings');
  if (settings.schema !== DEFAULT_SETTINGS.schema || typeof settings.automaticLocalDrafts !== 'boolean' || typeof settings.supportEmail !== 'string') {
    throw new Error('Error report settings are invalid.');
  }
  return { ...settings };
}

export function updateErrorReportSettings(projectRoot, changes) {
  strictFields(changes, new Set(['automaticLocalDrafts', 'supportEmail']), 'Error report settings update');
  const current = errorReportSettings(projectRoot);
  const next = { ...current };
  if ('automaticLocalDrafts' in changes) {
    if (typeof changes.automaticLocalDrafts !== 'boolean') throw new Error('automaticLocalDrafts must be boolean only.');
    next.automaticLocalDrafts = changes.automaticLocalDrafts;
  }
  if ('supportEmail' in changes) {
    const email = String(changes.supportEmail ?? '').trim();
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) throw new Error('Support email is invalid.');
    next.supportEmail = email;
  }
  atomicJson(paths(projectRoot).errorReportSettingsPath, next);
  return next;
}

export function createLocalErrorReport(projectRoot, input, options = {}) {
  const base = paths(projectRoot);
  const report = createErrorReportDraft(input, options);
  if (readLocalErrorReport(projectRoot, report.id)) throw new Error(`Error report already exists: ${report.id}`);
  atomicJson(draftPath(base, report.id), report);
  return safeProjection(report);
}

export function readLocalErrorReport(projectRoot, reportId) {
  const base = paths(projectRoot);
  const id = safeReportId(reportId);
  return safeProjection(readJson(draftPath(base, id)) ?? latestPackagedReport(base, id) ?? archivedReport(base, id));
}

export function listLocalErrorReports(projectRoot, options = {}) {
  const base = paths(projectRoot);
  const ids = new Set();
  for (const entry of readdirSync(base.errorReportDraftsRoot)) if (entry.endsWith('.json')) ids.add(entry.slice(0, -5));
  for (const entry of readdirSync(base.errorReportPackagesRoot, { withFileTypes: true })) if (entry.isDirectory()) ids.add(entry.name);
  for (const entry of readdirSync(base.errorReportArchiveRoot, { withFileTypes: true })) if (entry.isDirectory()) ids.add(entry.name);
  let reports = [...ids].map((id) => readLocalErrorReport(projectRoot, id)).filter(Boolean)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  if (options.status) reports = reports.filter((report) => report.status === options.status);
  return { schema: 'ewai.error-report-workspace/v1', localOnly: true, settings: errorReportSettings(projectRoot), reports };
}

export function updateLocalErrorReport(projectRoot, reportId, changes, options = {}) {
  const base = paths(projectRoot);
  const current = readLocalErrorReport(projectRoot, reportId);
  if (!current) throw new Error('Error report not found.');
  let source = current;
  if (current.status === 'finalised' || current.status === 'archived') {
    source = { ...current, status: 'draft', attachments: [] };
    delete source.package;
  }
  const revised = reviseErrorReport(source, changes, options);
  atomicJson(draftPath(base, revised.id), revised);
  return safeProjection(revised);
}

function packageLocation(base, report) {
  return resolve(revisionFolder(base, report.id, report.revision), `${report.id}-r${report.revision}.zip`);
}

export function finaliseLocalErrorReport(projectRoot, reportId, options = {}) {
  const base = paths(projectRoot);
  const current = readLocalErrorReport(projectRoot, reportId);
  if (!current) throw new Error('Error report not found.');
  if (current.status === 'finalised') throw new Error('Error report is already finalised.');
  if (current.status !== 'draft') throw new Error('Only a draft error report can be finalised.');
  const result = finaliseErrorReport(current, options);
  const folder = revisionFolder(base, current.id, current.revision);
  const zipPath = packageLocation(base, current);
  mkdirSync(folder, { recursive: true });
  atomicBuffer(zipPath, result.package.bytes);
  atomicJson(resolve(folder, 'report.json'), result.report);
  rmSync(draftPath(base, current.id), { force: true });
  return {
    report: safeProjection(result.report),
    package: {
      relativePath: relative(resolve(projectRoot), zipPath).replaceAll('\\', '/'),
      packageDigest: result.package.packageDigest,
      archiveDigest: result.package.archiveDigest,
      size: result.package.size,
      memberCount: result.package.memberCount,
    },
  };
}

function dedupePath(base) {
  return resolve(base.errorReportsRoot, 'deduplication.json');
}

export function captureErrorReportFailure(projectRoot, input, options = {}) {
  if (!errorReportSettings(projectRoot).automaticLocalDrafts) return { captured: false, reason: 'automatic-local-drafts-disabled' };
  const base = paths(projectRoot);
  const candidate = createErrorReportDraft(input, { ...options, id: options.id ?? `report_${randomUUID().replaceAll('-', '')}` });
  const fingerprint = errorReportIdentity({ ...candidate, id: 'report_deduplicated', revision: 1 });
  const index = readJson(dedupePath(base), { schema: 'ewai.error-report-deduplication/v1', reports: {} });
  const existing = index.reports[fingerprint] ? readLocalErrorReport(projectRoot, index.reports[fingerprint]) : null;
  if (existing) return { captured: true, deduplicated: true, report: existing, transmission: 'none' };
  atomicJson(draftPath(base, candidate.id), candidate);
  index.reports[fingerprint] = candidate.id;
  atomicJson(dedupePath(base), index);
  return { captured: true, deduplicated: false, report: safeProjection(candidate), transmission: 'none' };
}

function finalisedReport(projectRoot, reportId) {
  const report = readLocalErrorReport(projectRoot, reportId);
  if (!report) throw new Error('Error report not found.');
  if (report.status !== 'finalised' || !report.package?.archiveDigest) throw new Error('Error report must be finalised first.');
  return report;
}

function assertDigest(report, expectedDigest) {
  if (!expectedDigest || expectedDigest !== report.package.archiveDigest) throw new Error('Exact finalised package digest confirmation does not match.');
}

export function prepareErrorReportEmail(projectRoot, reportId, options = {}) {
  const base = paths(projectRoot);
  const report = finalisedReport(projectRoot, reportId);
  assertDigest(report, options.expectedDigest);
  const recipient = String(options.recipient ?? errorReportSettings(projectRoot).supportEmail ?? '').trim();
  if (recipient && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254)) throw new Error('Email recipient is invalid.');
  const subject = `EWAI error report ${report.id}`;
  const body = `Report: ${report.id}\nPackage digest: ${report.package.archiveDigest}\n\nThe ZIP must be attached manually before sending.`;
  const query = new URLSearchParams({ subject, body });
  const zipPath = packageLocation(base, report);
  const preparation = {
    schema: 'ewai.error-report-email-preparation/v1',
    id: randomUUID(),
    reportId: report.id,
    revision: report.revision,
    archiveDigest: report.package.archiveDigest,
    status: 'prepared-not-sent',
    mailto: `mailto:${recipient}?${query.toString()}`,
    packageReference: relative(resolve(projectRoot), zipPath).replaceAll('\\', '/'),
    message: 'Email prepared but not sent. Reveal the package and attach the ZIP manually before you send it.',
    preparedAt: String(options.at ?? now()),
  };
  if (options.launch === true) preparation.handoff = launchEmailHandoff(zipPath, preparation.mailto, options);
  const folder = resolve(base.errorReportReceiptsRoot, report.id);
  mkdirSync(folder, { recursive: true });
  atomicJson(resolve(folder, `email-${preparation.id}.json`), preparation);
  return preparation;
}

function handoffCommands(zipPath, mailto, platform) {
  if (platform === 'darwin') return [
    { target: 'package', command: 'open', args: ['-R', zipPath] },
    { target: 'email-client', command: 'open', args: [mailto] },
  ];
  if (platform === 'win32') return [
    { target: 'package', command: 'explorer.exe', args: [`/select,${zipPath}`] },
    { target: 'email-client', command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', mailto] },
  ];
  if (platform === 'linux') return [
    { target: 'package', command: 'xdg-open', args: [resolve(zipPath, '..')] },
    { target: 'email-client', command: 'xdg-open', args: [mailto] },
  ];
  return [];
}

function launchEmailHandoff(zipPath, mailto, options = {}) {
  const platform = String(options.platform ?? process.platform);
  const commands = handoffCommands(zipPath, mailto, platform);
  if (!commands.length) return {
    requested: true,
    status: 'unsupported-platform',
    packageReveal: 'not-launched',
    emailClient: 'not-launched',
  };
  const launcher = options.launcher ?? ((command, args) => spawnSync(command, args, {
    env: { PATH: process.env.PATH ?? '', LANG: 'C' },
    shell: false,
    stdio: 'ignore',
    timeout: 5_000,
  }));
  const outcomes = commands.map(({ target, command, args }) => {
    try {
      const result = launcher(command, args);
      return [target, result?.status === 0 && !result?.error ? 'launch-requested' : 'launch-failed'];
    } catch {
      return [target, 'launch-failed'];
    }
  });
  const byTarget = Object.fromEntries(outcomes);
  return {
    requested: true,
    status: outcomes.every(([, status]) => status === 'launch-requested') ? 'launch-requested' : 'partially-launched',
    packageReveal: byTarget.package,
    emailClient: byTarget['email-client'],
  };
}

export function archiveErrorReport(projectRoot, reportId, options = {}) {
  if (options.confirmed !== true) throw new Error('Archiving local report material requires explicit confirmation.');
  const base = paths(projectRoot);
  const report = readLocalErrorReport(projectRoot, reportId);
  if (!report) throw new Error('Error report not found.');
  const archived = { ...report, status: 'archived', updatedAt: String(options.at ?? now()) };
  const folder = resolve(base.errorReportArchiveRoot, report.id);
  mkdirSync(folder, { recursive: true });
  atomicJson(resolve(folder, `revision-${report.revision}.json`), archived);
  rmSync(draftPath(base, report.id), { force: true });
  rmSync(reportPackageRoot(base, report.id), { recursive: true, force: true });
  return safeProjection(archived);
}

export function deleteErrorReport(projectRoot, reportId, options = {}) {
  if (options.confirmed !== true) throw new Error('Deleting local error-report material requires explicit confirmation.');
  const base = paths(projectRoot);
  const id = safeReportId(reportId);
  const existed = Boolean(readLocalErrorReport(projectRoot, id));
  rmSync(draftPath(base, id), { force: true });
  rmSync(reportPackageRoot(base, id), { recursive: true, force: true });
  rmSync(resolve(base.errorReportArchiveRoot, id), { recursive: true, force: true });
  return {
    schema: 'ewai.error-report-deletion/v1',
    reportId: id,
    localMaterialRemoved: existed,
    providerReceiptsRetained: listErrorReportReceipts(projectRoot, id).receipts.length,
    externalRecall: false,
  };
}

function packageDigest(root) {
  let count = 0;
  let total = 0;
  const files = [];
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(folder, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error('Error-report provider packages cannot contain symbolic links.');
      if (stats.isDirectory()) visit(path);
      else if (stats.isFile()) {
        count += 1;
        total += stats.size;
        if (count > maxAdapterFiles || total > maxAdapterBytes) throw new Error('Error-report provider package exceeds safe limits.');
        files.push({ path, name: relative(root, path).replaceAll('\\', '/'), mode: stats.mode & 0o777 });
      } else throw new Error('Error-report provider packages may contain only regular files and directories.');
    }
  };
  visit(root);
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = readFileSync(file.path);
    hash.update(`${file.name.length}:${file.name}:${file.mode}:${bytes.length}:`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}

function readProviderManifest(adapterRoot) {
  const root = resolve(adapterRoot);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Provider root must be an existing non-symbolic directory.');
  const trustedRoot = realpathSync(root);
  const path = resolve(trustedRoot, 'error-report-provider.json');
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Provider requires error-report-provider.json.');
  if (statSync(path).size > maxManifestBytes) throw new Error('Provider manifest is too large.');
  const bytes = readFileSync(path);
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Provider manifest must be valid JSON.'); }
  strictFields(manifest, manifestFields, 'Provider manifest');
  if (manifest.schema !== 'ewai.error-report-provider/v1') throw new Error('Unsupported provider manifest schema.');
  if (!adapterIdPattern.test(String(manifest.id ?? ''))) throw new Error('Provider id is invalid.');
  if (!String(manifest.name ?? '').trim() || String(manifest.name).length > 120) throw new Error('Provider name is invalid.');
  strictFields(manifest.publisher, publisherFields, 'Provider publisher');
  if (!adapterIdPattern.test(String(manifest.publisher.id ?? '')) || !String(manifest.publisher.name ?? '').trim()) throw new Error('Provider publisher is invalid.');
  if (!versionPattern.test(String(manifest.version ?? '')) || manifest.protocolVersion !== '1') throw new Error('Provider version or protocol version is invalid.');
  const entry = String(manifest.entrypoint ?? '').trim();
  if (!entry || isAbsolute(entry)) throw new Error('Provider entrypoint must be relative.');
  const entrypoint = resolve(trustedRoot, entry);
  if (!isWithin(trustedRoot, entrypoint) || !existsSync(entrypoint) || lstatSync(entrypoint).isSymbolicLink() || !lstatSync(entrypoint).isFile() || !isWithin(trustedRoot, realpathSync(entrypoint))) {
    throw new Error('Provider entrypoint must be a regular file within the trusted package.');
  }
  try { accessSync(entrypoint, constants.X_OK); } catch { throw new Error('Provider entrypoint must be executable.'); }
  return { manifest, trustedRoot, entrypoint, manifestDigest: `sha256:${sha256(bytes)}`, packageDigest: packageDigest(trustedRoot) };
}

function safeProvider(value) {
  return {
    id: value.manifest.id,
    name: value.manifest.name,
    publisher: value.manifest.publisher,
    version: value.manifest.version,
    protocolVersion: value.manifest.protocolVersion,
    manifestDigest: value.manifestDigest,
    packageDigest: value.packageDigest,
    registeredAt: value.registeredAt ?? null,
  };
}

export function validateErrorReportProvider(adapterRoot) {
  return safeProvider(readProviderManifest(adapterRoot));
}

function registryPath(base) {
  return resolve(base.errorReportAdaptersRoot, 'registry.json');
}

function providerRegistry(base) {
  return readJson(registryPath(base), { schema: 'ewai.error-report-provider-registry/v1', providers: [] });
}

export function registerErrorReportProvider(projectRoot, adapterRoot, options = {}) {
  if (options.confirmed !== true) throw new Error('Provider registration requires explicit confirmation because it trusts local code.');
  const base = paths(projectRoot);
  const validated = readProviderManifest(adapterRoot);
  const registry = providerRegistry(base);
  const previous = registry.providers.find((entry) => entry.manifest.id === validated.manifest.id);
  if (previous && previous.manifest.version === validated.manifest.version && previous.packageDigest !== validated.packageDigest) {
    throw new Error('Provider same-version package digest drift is not allowed.');
  }
  const record = { ...validated, registeredAt: now() };
  registry.providers = [...registry.providers.filter((entry) => entry.manifest.id !== validated.manifest.id), record]
    .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  atomicJson(registryPath(base), registry);
  return safeProvider(record);
}

export function listErrorReportProviders(projectRoot) {
  const base = paths(projectRoot);
  return { schema: 'ewai.error-report-providers/v1', providers: providerRegistry(base).providers.map(safeProvider) };
}

function invokeProvider(provider, request, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(provider.entrypoint, [], {
      cwd: provider.trustedRoot,
      env: { PATH: process.env.PATH ?? '', LANG: 'C', EWAI_ERROR_REPORT_PROTOCOL: '1' },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderrSize = 0;
    let oversized = false;
    let timedOut = false;
    child.stdout.on('data', (chunk) => {
      if (stdout.length + chunk.length > maxAdapterOutputBytes) { oversized = true; child.kill('SIGTERM'); }
      else stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on('data', (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize > maxAdapterOutputBytes) { oversized = true; child.kill('SIGTERM'); }
    });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    timer.unref();
    child.once('error', (error) => { clearTimeout(timer); resolvePromise({ exitCode: -1, stdout, oversized, timedOut, error }); });
    child.once('close', (code) => { clearTimeout(timer); resolvePromise({ exitCode: code ?? -1, stdout, oversized, timedOut, error: null }); });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function safeFailureReason(result, error) {
  if (result?.timedOut) return 'provider-timeout';
  if (result?.oversized) return 'provider-output-limit';
  if (result?.error || result?.exitCode !== 0) return 'provider-execution-failed';
  if (/digest/i.test(String(error?.message))) return 'provider-digest-mismatch';
  if (/rejected/i.test(String(error?.message))) return 'provider-rejected';
  return 'provider-response-invalid';
}

function validateAcknowledgement(response, expected) {
  strictFields(response, acknowledgementFields, 'Provider acknowledgement');
  if (response.schema !== 'ewai.error-report-provider-ack/v1') throw new Error('Provider acknowledgement schema is invalid.');
  if (response.attemptId !== expected.attemptId) throw new Error('Provider attempt identity does not match.');
  if (response.archiveDigest !== expected.archiveDigest) throw new Error('Provider package digest does not match.');
  if (!['accepted', 'rejected'].includes(response.status)) throw new Error('Provider status is invalid.');
  if (response.status !== 'accepted') throw new Error('Provider rejected the report package.');
  const externalReference = String(response.externalReference ?? '').trim();
  if (!externalReference || externalReference.length > 240 || /[\u0000-\u001f]/.test(externalReference)) throw new Error('Provider external reference is invalid.');
  return { status: 'accepted', externalReference };
}

function receiptFolder(base, id) {
  return resolve(base.errorReportReceiptsRoot, safeReportId(id));
}

export async function submitErrorReportProvider(projectRoot, reportId, providerId, options = {}) {
  if (options.confirmed !== true) throw new Error('Provider submission requires explicit confirmation.');
  const base = paths(projectRoot);
  const report = finalisedReport(projectRoot, reportId);
  assertDigest(report, options.expectedDigest);
  if (!adapterIdPattern.test(String(providerId ?? ''))) throw new Error('Provider id is invalid.');
  const provider = providerRegistry(base).providers.find((entry) => entry.manifest.id === providerId);
  if (!provider) throw new Error('Registered error-report provider not found.');
  const current = readProviderManifest(provider.trustedRoot);
  if (current.packageDigest !== provider.packageDigest || current.manifestDigest !== provider.manifestDigest) throw new Error('Registered provider package has changed and must be registered again.');
  const attemptId = randomUUID();
  const zipPath = packageLocation(base, report);
  const request = {
    schema: 'ewai.error-report-submission/v1',
    attemptId,
    reportId: report.id,
    revision: report.revision,
    archiveDigest: report.package.archiveDigest,
    packagePath: zipPath,
    packageSize: report.package.size,
  };
  const folder = receiptFolder(base, report.id);
  mkdirSync(folder, { recursive: true });
  let result;
  let acknowledged;
  try {
    result = await invokeProvider(current, request, Math.min(Math.max(Number(options.timeoutMs ?? defaultTimeoutMs), 100), 120_000));
    if (result.timedOut || result.oversized || result.error || result.exitCode !== 0) throw new Error('Provider execution did not complete safely.');
    let response;
    try { response = JSON.parse(result.stdout.toString('utf8')); } catch { throw new Error('Provider response is malformed.'); }
    acknowledged = validateAcknowledgement(response, request);
  } catch (error) {
    const attempt = {
      schema: 'ewai.error-report-attempt/v1', id: attemptId, reportId: report.id, revision: report.revision,
      providerId, archiveDigest: report.package.archiveDigest, status: 'failed', reason: safeFailureReason(result, error),
      attemptedAt: String(options.at ?? now()), retryable: true,
    };
    atomicJson(resolve(folder, `attempt-${attemptId}.json`), attempt);
    return attempt;
  }
  const attempt = {
    schema: 'ewai.error-report-attempt/v1', id: attemptId, reportId: report.id, revision: report.revision,
    providerId, archiveDigest: report.package.archiveDigest, status: acknowledged.status,
    externalReference: acknowledged.externalReference, attemptedAt: String(options.at ?? now()), retryable: false,
  };
  const receipt = {
    schema: 'ewai.error-report-receipt/v1', id: randomUUID(), attemptId, reportId: report.id,
    providerId, archiveDigest: report.package.archiveDigest, status: 'accepted',
    externalReference: acknowledged.externalReference, acceptedAt: attempt.attemptedAt,
    assurance: 'Transport accepted by the provider; issue resolution, security acceptance and release remain unproven.',
  };
  atomicJson(resolve(folder, `attempt-${attemptId}.json`), attempt);
  atomicJson(resolve(folder, `receipt-${receipt.id}.json`), receipt);
  return attempt;
}

export function listErrorReportReceipts(projectRoot, reportId) {
  const base = paths(projectRoot);
  const folder = receiptFolder(base, reportId);
  if (!existsSync(folder)) return { schema: 'ewai.error-report-receipts/v1', reportId: safeReportId(reportId), attempts: [], receipts: [] };
  const values = readdirSync(folder).filter((name) => name.endsWith('.json')).map((name) => readJson(resolve(folder, name))).filter(Boolean);
  return {
    schema: 'ewai.error-report-receipts/v1',
    reportId: safeReportId(reportId),
    attempts: values.filter((value) => value.schema === 'ewai.error-report-attempt/v1').sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt)),
    receipts: values.filter((value) => value.schema === 'ewai.error-report-receipt/v1').sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt)),
  };
}
