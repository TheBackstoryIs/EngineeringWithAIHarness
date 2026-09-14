import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  ASSURANCE_NOTICE,
  SECURITY_CAPABILITIES,
  SECURITY_PROVIDER_CATALOGUE,
  normaliseSecurityValidationConfig,
  securityProvider,
} from '../security-validation-config.mjs';
import { isWithin, now, sha256 } from '../delivery-documents.mjs';
import { loadProjectConfig } from '../project.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { selectContextualPersonas } from './persona-engagement.mjs';

const manifestFields = new Set([
  'schema', 'id', 'name', 'publisher', 'version', 'protocolVersion', 'capabilities', 'entrypoint',
]);
const publisherFields = new Set(['id', 'name']);
const adapterIdPattern = /^[a-z][a-z0-9.-]{1,79}$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const maxManifestBytes = 64 * 1024;
const maxAdapterOutputBytes = 1024 * 1024;
const maxProviderArtefactBytes = 10 * 1024 * 1024;
const maxAdapterPackageBytes = 64 * 1024 * 1024;
const maxAdapterPackageFiles = 1024;
const maxRevisionDiffBytes = 64 * 1024 * 1024;
const activeSecurityProcesses = new Map();
const responseFields = new Set(['schema', 'runId', 'status', 'complete', 'capabilities', 'tool', 'findings', 'warnings']);
const findingFields = new Set(['id', 'capability', 'severity', 'confidence', 'summary', 'locations', 'remediation', 'evidence']);
const toolFields = new Set(['name', 'version']);

function strictFields(value, fields, label) {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new Error(`${label} contains unknown field: ${key}`);
  }
}

function safeProviderProjection(provider, state, signals = []) {
  return {
    id: provider.id,
    name: provider.name,
    publisher: provider.publisher,
    state,
    official_sources: [...provider.official_sources],
    capabilities: [...provider.capabilities],
    artifact_import_supported: provider.artifact_import_supported === true,
    summary: provider.summary,
    cautions: [...provider.cautions],
    detected_signals: [...signals],
  };
}

function safeAdapterProjection(row) {
  return {
    id: row.id,
    name: row.name,
    publisher: { id: row.publisher_id, name: row.publisher_name },
    version: row.version,
    protocolVersion: row.protocol_version,
    capabilities: JSON.parse(row.capabilities_json),
    manifestDigest: row.manifest_digest,
    packageDigest: row.package_digest,
    registeredAt: row.registered_at,
    updatedAt: row.updated_at,
  };
}

function safeRunProjection(row) {
  return {
    id: row.id,
    profileId: row.profile_id,
    providerId: row.provider_id ?? null,
    adapterId: row.adapter_id ?? null,
    interactionMode: row.interaction_mode,
    capability: row.capability,
    status: row.status,
    revision: row.revision,
    scope: JSON.parse(row.scope_json),
    targetClass: row.target_class ?? null,
    targetRef: row.target_ref ?? null,
    complete: Boolean(row.complete),
    outcome: row.outcome,
    reportDigest: row.report_digest,
    policyDigest: row.policy_digest,
    tool: JSON.parse(row.tool_json || '{}'),
    redactionStatus: row.redaction_status,
    warnings: JSON.parse(row.warnings_json),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function profileDigest(profile) {
  return sha256(JSON.stringify(profile));
}

function safeFindingProjection(row) {
  return {
    id: row.finding_key,
    recordId: row.id,
    runId: row.run_id,
    capability: row.capability,
    providerSeverity: row.provider_severity,
    providerConfidence: row.provider_confidence,
    summary: row.summary,
    locations: JSON.parse(row.locations_json),
    remediation: row.remediation,
    evidence: JSON.parse(row.evidence_json),
    policyConsequence: row.policy_consequence,
    createdAt: row.created_at,
  };
}

function securityPolicy(projectRoot) {
  return normaliseSecurityValidationConfig(loadProjectConfig(projectRoot).config);
}

function policyDigest(policy) {
  return sha256(JSON.stringify(policy));
}

export function captureSecurityPolicy(projectRoot, options = {}) {
  const policy = securityPolicy(projectRoot);
  return {
    schema: 'ewai.security-policy-snapshot/v1',
    capturedAt: String(options.capturedAt ?? now()),
    policyDigest: policyDigest(policy),
    policy,
  };
}

function profileFor(projectRoot, profileId) {
  const policy = securityPolicy(projectRoot);
  if (!policy.enabled) throw new Error('Security validation is not configured for this project.');
  const profile = policy.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Unknown security profile: ${profileId}`);
  return { policy, profile };
}

function credentialShaped(value) {
  return /(?:Bearer\s+[A-Za-z0-9._~+\/-]{12,}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(value);
}

function safeRelativeReference(projectRoot, value, label, options = {}) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 500 || credentialShaped(text)) throw new Error(`${label} is unsafe.`);
  const pathPart = text.replace(/:\d+(?::\d+)?$/, '');
  if (isAbsolute(pathPart) || pathPart === '..' || pathPart.startsWith('../') || pathPart.includes('/../')) {
    throw new Error(`${label} must be project-relative.`);
  }
  const absolute = resolve(projectRoot, pathPart);
  if (!isWithin(resolve(projectRoot), absolute)) throw new Error(`${label} escapes the project.`);
  if (options.requireExists) {
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || (!lstatSync(absolute).isFile() && !lstatSync(absolute).isDirectory())) {
      throw new Error(`${label} must reference existing non-symbolic project evidence.`);
    }
  }
  return text;
}

function validateScanResponse(projectRoot, response, expected) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Security adapter response must be an object.');
  strictFields(response, responseFields, 'Security adapter response');
  if (response.schema !== 'ewai.security-scan-response/v1') throw new Error('Unsupported security scan response schema.');
  if (response.runId !== expected.runId) throw new Error('Security adapter response run identity does not match.');
  if (!['complete', 'incomplete', 'failed'].includes(response.status)) throw new Error('Security adapter response status is invalid.');
  if (typeof response.complete !== 'boolean') throw new Error('Security adapter response completeness is required.');
  if ((response.status === 'complete') !== response.complete) throw new Error('Security adapter response status and completeness disagree.');
  if (!Array.isArray(response.capabilities) || !response.capabilities.length || response.capabilities.length > SECURITY_CAPABILITIES.length || !response.capabilities.includes(expected.capability)) {
    throw new Error('Security adapter response does not evidence the requested capability.');
  }
  if (new Set(response.capabilities).size !== response.capabilities.length) throw new Error('Security adapter response capabilities must be unique.');
  for (const capability of response.capabilities) {
    if (!SECURITY_CAPABILITIES.includes(capability)) throw new Error(`Unsupported response capability: ${capability}`);
  }
  let tool = null;
  if (response.tool !== undefined) {
    if (!response.tool || typeof response.tool !== 'object' || Array.isArray(response.tool)) throw new Error('Security adapter response tool must be an object.');
    strictFields(response.tool, toolFields, 'Security adapter response tool');
    const toolName = String(response.tool.name ?? '').trim();
    const toolVersion = String(response.tool.version ?? '').trim();
    if (!toolName || toolName.length > 120 || !toolVersion || toolVersion.length > 80 || credentialShaped(`${toolName} ${toolVersion}`)) {
      throw new Error('Security adapter response tool identity is unsafe.');
    }
    tool = { name: toolName, version: toolVersion };
  }
  if (!Array.isArray(response.findings) || response.findings.length > 10000) throw new Error('Security adapter response findings must be a bounded array.');
  const seen = new Set();
  const findings = response.findings.map((finding) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) throw new Error('Security finding must be an object.');
    strictFields(finding, findingFields, 'Security finding');
    const id = String(finding.id ?? '').trim();
    if (!id || id.length > 160 || credentialShaped(id) || seen.has(id)) throw new Error('Security finding identity is missing, unsafe or duplicated.');
    seen.add(id);
    const capability = String(finding.capability ?? '').trim();
    if (!response.capabilities.includes(capability)) throw new Error('Security finding capability is not evidenced by this response.');
    const severity = String(finding.severity ?? 'unknown').trim().toLowerCase();
    if (!['critical', 'high', 'medium', 'low', 'info', 'unknown'].includes(severity)) throw new Error('Security finding severity is invalid.');
    const confidence = finding.confidence === undefined ? null : Number(finding.confidence);
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new Error('Security finding confidence is invalid.');
    const summary = String(finding.summary ?? '').trim();
    const remediation = String(finding.remediation ?? '').trim();
    if (!summary || summary.length > 1000 || remediation.length > 2000 || credentialShaped(summary) || credentialShaped(remediation)) {
      throw new Error('Security finding contains unsafe or excessive text.');
    }
    if (finding.locations !== undefined && (!Array.isArray(finding.locations) || finding.locations.length > 100)) throw new Error('Security finding locations must be a bounded array.');
    if (finding.evidence !== undefined && (!Array.isArray(finding.evidence) || finding.evidence.length > 100)) throw new Error('Security finding evidence must be a bounded array.');
    const locations = Array.isArray(finding.locations) ? finding.locations.map((value) => safeRelativeReference(projectRoot, value, 'Security finding location')) : [];
    const evidence = Array.isArray(finding.evidence) ? finding.evidence.map((value) => safeRelativeReference(projectRoot, value, 'Security evidence reference')) : [];
    return { id, capability, severity, confidence, summary, locations, remediation, evidence };
  });
  if (response.warnings !== undefined && (!Array.isArray(response.warnings) || response.warnings.length > 1000)) throw new Error('Security response warnings must be a bounded array.');
  const warnings = Array.isArray(response.warnings)
    ? response.warnings.map((warning) => String(warning).trim()).filter(Boolean).map((warning) => {
        if (warning.length > 500 || credentialShaped(warning)) throw new Error('Security response warning is unsafe.');
        return warning;
      })
    : [];
  return { status: response.status, complete: response.complete, capabilities: [...response.capabilities], tool, findings, warnings };
}

function persistValidatedResponse(database, run, response, reportDigest) {
  const completedAt = now();
  const profileSnapshot = JSON.parse(run.profile_snapshot_json || '{}');
  const blockingSeverities = new Set(profileSnapshot.thresholds?.blocking_severities ?? ['critical', 'high']);
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const finding of response.findings) {
      database.prepare(`
        INSERT INTO security_findings (
          id, run_id, finding_key, capability, provider_severity, provider_confidence,
          summary, locations_json, remediation, evidence_json, policy_consequence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), run.id, finding.id, finding.capability, finding.severity, finding.confidence,
        finding.summary, JSON.stringify(finding.locations), finding.remediation, JSON.stringify(finding.evidence),
        blockingSeverities.has(finding.severity) ? 'blocking' : 'review', completedAt,
      );
    }
    database.prepare(`
      UPDATE security_runs
      SET status = ?, complete = ?, outcome = ?, report_digest = ?, tool_json = ?, redaction_status = ?, warnings_json = ?, completed_at = ?
      WHERE id = ?
    `).run(
      response.status,
      response.complete ? 1 : 0,
      response.status,
      reportDigest,
      JSON.stringify(response.tool ?? {}),
      'safe-fields-only',
      JSON.stringify(response.warnings),
      completedAt,
      run.id,
    );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function digestAdapterPackage(trustedRoot) {
  const files = [];
  let totalBytes = 0;
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(folder, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error('Security adapter packages cannot contain symbolic links.');
      if (stats.isDirectory()) {
        visit(path);
        continue;
      }
      if (!stats.isFile()) throw new Error('Security adapter packages can contain only regular files and directories.');
      totalBytes += stats.size;
      if (files.length + 1 > maxAdapterPackageFiles || totalBytes > maxAdapterPackageBytes) {
        throw new Error('Security adapter package exceeds the safe file or byte limit.');
      }
      files.push({ path, relativePath: relative(trustedRoot, path).replaceAll('\\', '/'), stats });
    }
  };
  visit(trustedRoot);
  const hash = createHash('sha256');
  for (const file of files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    const bytes = readFileSync(file.path);
    hash.update(`${Buffer.byteLength(file.relativePath)}:${file.relativePath}:${file.stats.mode & 0o777}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function markRunFailed(projectRoot, runId, status, warning = '') {
  const database = openRuntimeDatabase(projectRoot);
  try {
    database.prepare(`UPDATE security_runs SET status = ?, complete = 0, outcome = ?, warnings_json = ?, completed_at = ? WHERE id = ?`)
      .run(status, status, JSON.stringify(warning ? [warning] : []), now(), runId);
    return safeRunProjection(database.prepare('SELECT * FROM security_runs WHERE id = ?').get(runId));
  } finally {
    database.close();
  }
}

function adapterInvocation(executable, request, projectRoot, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(executable, [], {
      cwd: resolve(projectRoot),
      env: { PATH: process.env.PATH ?? '', LANG: 'C', EWAI_SECURITY_PROTOCOL: '1' },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderrBytes = 0;
    let oversized = false;
    let timedOut = false;
    child.stdout.on('data', (chunk) => {
      if (stdout.length + chunk.length > maxAdapterOutputBytes) {
        oversized = true;
        child.kill('SIGTERM');
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxAdapterOutputBytes) {
        oversized = true;
        child.kill('SIGTERM');
      }
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
    }, timeoutMs);
    timeout.unref();
    activeSecurityProcesses.set(request.runId, child);
    child.once('error', (error) => {
      clearTimeout(timeout);
      activeSecurityProcesses.delete(request.runId);
      resolvePromise({ exitCode: -1, signal: '', stdout, oversized, timedOut, error });
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      activeSecurityProcesses.delete(request.runId);
      resolvePromise({ exitCode: exitCode ?? -1, signal: signal ?? '', stdout, oversized, timedOut, error: null });
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function readManifest(adapterRoot) {
  const root = resolve(adapterRoot);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error('Security adapter root must be an existing non-symbolic-link directory.');
  }
  const trustedRoot = realpathSync(root);
  const manifestPath = resolve(trustedRoot, 'security-adapter.json');
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink()) {
    throw new Error('Security adapter requires a regular security-adapter.json manifest.');
  }
  if (statSync(manifestPath).size > maxManifestBytes) throw new Error('Security adapter manifest is too large.');
  let manifest;
  const manifestBytes = readFileSync(manifestPath);
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('Security adapter manifest must be valid JSON.');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Security adapter manifest must be an object.');
  strictFields(manifest, manifestFields, 'Security adapter manifest');
  if (manifest.schema !== 'ewai.security-adapter/v1') throw new Error('Unsupported security adapter manifest schema.');
  if (!adapterIdPattern.test(String(manifest.id ?? ''))) throw new Error('Security adapter id is invalid.');
  if (!String(manifest.name ?? '').trim() || String(manifest.name).length > 120) throw new Error('Security adapter name is invalid.');
  if (!manifest.publisher || typeof manifest.publisher !== 'object' || Array.isArray(manifest.publisher)) throw new Error('Security adapter publisher is required.');
  strictFields(manifest.publisher, publisherFields, 'Security adapter publisher');
  if (!adapterIdPattern.test(String(manifest.publisher.id ?? '')) || !String(manifest.publisher.name ?? '').trim()) {
    throw new Error('Security adapter publisher identity is invalid.');
  }
  if (!versionPattern.test(String(manifest.version ?? ''))) throw new Error('Security adapter version must be semantic version text.');
  if (manifest.protocolVersion !== '1') throw new Error('Unsupported security adapter protocol version.');
  if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.length) throw new Error('Security adapter capabilities are required.');
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length) throw new Error('Security adapter capabilities must be unique.');
  for (const capability of manifest.capabilities) {
    if (!SECURITY_CAPABILITIES.includes(capability)) throw new Error(`Unsupported security adapter capability: ${capability}`);
  }
  const entrypointValue = String(manifest.entrypoint ?? '').trim();
  if (!entrypointValue || isAbsolute(entrypointValue)) throw new Error('Security adapter entrypoint must be relative to its trusted root.');
  const entrypoint = resolve(trustedRoot, entrypointValue);
  if (!isWithin(trustedRoot, entrypoint) || !existsSync(entrypoint) || lstatSync(entrypoint).isSymbolicLink() || !lstatSync(entrypoint).isFile()) {
    throw new Error('Security adapter entrypoint must be a regular file inside its trusted root.');
  }
  if (!isWithin(trustedRoot, realpathSync(entrypoint))) throw new Error('Security adapter entrypoint escapes its trusted root.');
  try {
    accessSync(entrypoint, constants.X_OK);
  } catch {
    throw new Error('Security adapter entrypoint must be executable.');
  }
  const manifestDigest = sha256(manifestBytes);
  return {
    manifest: {
      schema: manifest.schema,
      id: manifest.id,
      name: String(manifest.name).trim(),
      publisher: { id: manifest.publisher.id, name: String(manifest.publisher.name).trim() },
      version: manifest.version,
      protocolVersion: manifest.protocolVersion,
      capabilities: [...manifest.capabilities],
      entrypoint: entrypointValue,
    },
    trustedRoot,
    entrypoint: realpathSync(entrypoint),
    manifestDigest,
    packageDigest: digestAdapterPackage(trustedRoot),
  };
}

export function discoverSecurityProviders(projectRoot) {
  const root = realpathSync(resolve(projectRoot));
  const providers = SECURITY_PROVIDER_CATALOGUE.map((provider) => {
    const providerRoot = resolve(root, provider.discovery.root);
    if (!isWithin(root, providerRoot) || !existsSync(providerRoot)) return safeProviderProjection(provider, 'not-detected');
    const rootStat = lstatSync(providerRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(providerRoot) !== providerRoot) {
      return safeProviderProjection(provider, 'not-detected');
    }
    const signals = [];
    for (const signal of provider.discovery.signals) {
      const candidate = resolve(providerRoot, signal);
      if (!isWithin(providerRoot, candidate) || !existsSync(candidate)) continue;
      const candidateStat = lstatSync(candidate);
      if (candidateStat.isSymbolicLink() || (!candidateStat.isFile() && !candidateStat.isDirectory())) continue;
      signals.push(`${provider.discovery.root}/${signal}`);
    }
    return safeProviderProjection(provider, signals.length ? 'artefacts-detected' : 'not-detected', signals);
  });
  return { schema: 'ewai.security-provider-discovery/v1', providers, assurance_notice: ASSURANCE_NOTICE };
}

export function validateSecurityAdapter(projectRoot, adapterRoot) {
  const validated = readManifest(adapterRoot);
  return {
    schema: 'ewai.security-adapter-validation/v1',
    valid: true,
    adapter: {
      id: validated.manifest.id,
      name: validated.manifest.name,
      publisher: validated.manifest.publisher,
      version: validated.manifest.version,
      protocolVersion: validated.manifest.protocolVersion,
      capabilities: [...validated.manifest.capabilities],
      manifestDigest: validated.manifestDigest,
      packageDigest: validated.packageDigest,
    },
    assurance_notice: ASSURANCE_NOTICE,
  };
}

export function registerSecurityAdapter(projectRoot, adapterRoot, options = {}) {
  if (!options.confirmed) throw new Error('Security adapter registration requires explicit confirmation.');
  const validated = readManifest(adapterRoot);
  const database = openRuntimeDatabase(projectRoot);
  try {
    const existing = database.prepare('SELECT * FROM security_adapters WHERE id = ?').get(validated.manifest.id);
    if (existing && existing.package_digest !== validated.packageDigest && existing.version === validated.manifest.version) {
      throw new Error(`Security adapter ${validated.manifest.id} digest drift requires a new reviewed version or identity.`);
    }
    const timestamp = now();
    database.prepare(`
      INSERT INTO security_adapters (
        id, name, publisher_id, publisher_name, version, protocol_version,
        trusted_root, entrypoint, manifest_digest, package_digest, capabilities_json,
        manifest_json, registered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        publisher_id = excluded.publisher_id,
        publisher_name = excluded.publisher_name,
        version = excluded.version,
        protocol_version = excluded.protocol_version,
        trusted_root = excluded.trusted_root,
        entrypoint = excluded.entrypoint,
        manifest_digest = excluded.manifest_digest,
        package_digest = excluded.package_digest,
        capabilities_json = excluded.capabilities_json,
        manifest_json = excluded.manifest_json,
        updated_at = excluded.updated_at
    `).run(
      validated.manifest.id,
      validated.manifest.name,
      validated.manifest.publisher.id,
      validated.manifest.publisher.name,
      validated.manifest.version,
      validated.manifest.protocolVersion,
      validated.trustedRoot,
      validated.entrypoint,
      validated.manifestDigest,
      validated.packageDigest,
      JSON.stringify(validated.manifest.capabilities),
      JSON.stringify(validated.manifest),
      existing?.registered_at ?? timestamp,
      timestamp,
    );
    const row = database.prepare('SELECT * FROM security_adapters WHERE id = ?').get(validated.manifest.id);
    return { schema: 'ewai.security-adapter-registration/v1', adapter: safeAdapterProjection(row), assurance_notice: ASSURANCE_NOTICE };
  } finally {
    database.close();
  }
}

export function listSecurityAdapters(projectRoot) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const adapters = database.prepare('SELECT * FROM security_adapters ORDER BY name, id').all().map(safeAdapterProjection);
    return { schema: 'ewai.security-adapters/v1', adapters, assurance_notice: ASSURANCE_NOTICE };
  } finally {
    database.close();
  }
}

export function prepareSecuritySkillHandoff(projectRoot, input = {}) {
  realpathSync(resolve(projectRoot));
  const provider = securityProvider(String(input.providerId ?? ''));
  if (!provider) throw new Error(`Unknown security provider: ${input.providerId || '(empty)'}`);
  const profileId = String(input.profileId ?? '').trim();
  if (!profileId) throw new Error('Security skill handoff requires a profile ID.');
  const capability = String(input.capability ?? '').trim();
  if (!provider.capabilities.includes(capability)) throw new Error(`${provider.name} does not declare capability ${capability || '(empty)'}.`);
  const revision = String(input.revision ?? '').trim();
  if (!revision || revision.length > 240 || credentialShaped(revision)) throw new Error('Security skill handoff requires an exact safe repository or target revision.');
  const scope = Array.isArray(input.scope) ? input.scope.map((item) => String(item).trim()).filter(Boolean) : [];
  for (const path of scope) {
    if (isAbsolute(path) || path === '..' || path.startsWith('../') || path.includes('/../')) throw new Error('Security handoff scope must remain project-relative.');
  }
  return {
    schema: 'ewai.security-skill-handoff/v1',
    status: 'awaiting-evidence',
    evidence: null,
    handoff: {
      id: randomUUID(),
      provider: safeProviderProjection(provider, 'available'),
      profileId,
      capability,
      revision,
      scope,
      responseContract: 'ewai.security-scan-response/v1',
      preparedAt: now(),
    },
    assurance_notice: ASSURANCE_NOTICE,
  };
}

export function prepareSecurityRun(projectRoot, profileId, input = {}) {
  const { profile } = profileFor(projectRoot, profileId);
  if (!input.confirmed) throw new Error('Security run preparation requires explicit confirmation.');
  const mode = String(input.mode ?? (profile.adapter ? 'command' : profile.provider ? 'skill' : '')).trim();
  if (!profile.modes.includes(mode)) throw new Error(`Security profile ${profile.id} does not allow ${mode || 'the requested'} mode.`);
  const revision = String(input.trustedRevision ?? '').trim();
  if (!revision || revision.length > 240 || credentialShaped(revision)) throw new Error('Security run preparation requires a safe server-resolved repository or target revision.');
  if (profile.capability === 'llm-runtime-red-team') {
    if (!profile.target_ref || !profile.target_class) throw new Error('Runtime security profiles require a preconfigured safe target reference and class.');
    if (!input.confirmedRuntimeTarget) throw new Error('Runtime security profiles require explicit target confirmation.');
    if (profile.target_class === 'production') throw new Error('Production runtime security targets are denied by default.');
  }
  if (mode === 'skill') {
    return prepareSecuritySkillHandoff(projectRoot, {
      providerId: profile.provider,
      profileId: profile.id,
      capability: profile.capability,
      revision,
      scope: Array.isArray(profile.scope?.include) ? profile.scope.include : [],
    });
  }
  if (mode !== 'command') throw new Error('Artefact imports must be prepared through the server discovery-token operation.');
  if (!profile.adapter) throw new Error(`Security profile ${profile.id} has no registered adapter identity.`);
  const database = openRuntimeDatabase(projectRoot);
  try {
    const adapter = database.prepare('SELECT * FROM security_adapters WHERE id = ?').get(profile.adapter);
    if (!adapter) throw new Error(`Registered security adapter not found: ${profile.adapter}`);
    const capabilities = JSON.parse(adapter.capabilities_json);
    if (!capabilities.includes(profile.capability)) throw new Error(`Security adapter ${profile.adapter} does not support ${profile.capability}.`);
    const id = randomUUID();
    const timestamp = now();
    database.prepare(`
      INSERT INTO security_runs (
        id, profile_id, provider_id, adapter_id, interaction_mode, capability, status,
        revision, scope_json, target_class, target_ref, policy_digest, profile_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, 'command', ?, 'prepared', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, profile.id, profile.provider, profile.adapter, profile.capability, revision,
      JSON.stringify(profile.scope), profile.target_class, profile.target_ref,
      profileDigest(profile), JSON.stringify(profile), timestamp,
    );
    const run = safeRunProjection(database.prepare('SELECT * FROM security_runs WHERE id = ?').get(id));
    return { schema: 'ewai.security-run-preparation/v1', run, assurance_notice: ASSURANCE_NOTICE };
  } finally {
    database.close();
  }
}

export async function executeSecurityRun(projectRoot, runId) {
  let run;
  let adapter;
  let attemptId;
  let attemptOrdinal;
  const startedAt = now();
  const database = openRuntimeDatabase(projectRoot);
  try {
    run = database.prepare('SELECT * FROM security_runs WHERE id = ?').get(runId);
    if (!run) throw new Error(`Security run not found: ${runId}`);
    if (run.status !== 'prepared') throw new Error(`Security run ${runId} is not prepared.`);
    if (run.interaction_mode !== 'command' || !run.adapter_id) throw new Error('Only prepared command-adapter runs can execute locally.');
    adapter = database.prepare('SELECT * FROM security_adapters WHERE id = ?').get(run.adapter_id);
    if (!adapter) throw new Error(`Registered security adapter not found: ${run.adapter_id}`);
    const current = readManifest(adapter.trusted_root);
    if (current.packageDigest !== adapter.package_digest || current.entrypoint !== adapter.entrypoint) {
      throw new Error(`Security adapter ${adapter.id} digest drift prevents execution.`);
    }
    attemptOrdinal = Number(database.prepare('SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM security_attempts WHERE run_id = ?').get(runId).ordinal) + 1;
    attemptId = randomUUID();
    database.exec('BEGIN IMMEDIATE');
    database.prepare('UPDATE security_runs SET status = ?, started_at = ? WHERE id = ?').run('running', startedAt, runId);
    database.prepare(`INSERT INTO security_attempts (id, run_id, ordinal, status, started_at) VALUES (?, ?, ?, 'running', ?)`)
      .run(attemptId, runId, attemptOrdinal, startedAt);
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    database.close();
    throw error;
  }
  database.close();

  const request = {
    schema: 'ewai.security-scan-request/v1',
    runId,
    profile: { id: run.profile_id, capability: run.capability },
    project: { revision: run.revision },
    scope: JSON.parse(run.scope_json),
    target: run.target_ref ? { class: run.target_class, ref: run.target_ref } : null,
  };
  const timeoutMs = Math.max(1_000, Math.min(3_600_000, Number(profileFor(projectRoot, run.profile_id).profile.timeout_seconds) * 1000));
  const invocation = await adapterInvocation(adapter.entrypoint, request, projectRoot, timeoutMs);
  const completedAt = now();
  const after = openRuntimeDatabase(projectRoot);
  let cancellationRequested = false;
  try {
    cancellationRequested = after.prepare('SELECT status FROM security_runs WHERE id = ?').get(runId)?.status === 'cancelling';
    after.prepare(`
      UPDATE security_attempts SET status = ?, exit_code = ?, signal = ?, timed_out = ?,
        duration_ms = ?, completed_at = ? WHERE id = ?
    `).run(
      cancellationRequested ? 'cancelled' : invocation.timedOut ? 'timed-out' : invocation.oversized ? 'failed' : invocation.exitCode === 0 ? 'complete' : 'failed',
      invocation.exitCode, invocation.signal, invocation.timedOut ? 1 : 0,
      Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()), completedAt, attemptId,
    );
  } finally {
    after.close();
  }

  if (cancellationRequested) {
    return { schema: 'ewai.security-run-result/v1', run: markRunFailed(projectRoot, runId, 'cancelled', 'Adapter execution was cancelled.'), assurance_notice: ASSURANCE_NOTICE };
  }
  if (invocation.error || invocation.exitCode !== 0 || invocation.timedOut || invocation.oversized) {
    const warning = invocation.timedOut ? 'Adapter timed out.' : invocation.oversized ? 'Adapter output exceeded the safe limit.' : 'Adapter execution failed.';
    return { schema: 'ewai.security-run-result/v1', run: markRunFailed(projectRoot, runId, 'failed', warning), assurance_notice: ASSURANCE_NOTICE };
  }
  const reportDigest = sha256(invocation.stdout);
  try {
    const parsed = JSON.parse(invocation.stdout.toString('utf8'));
    const validated = validateScanResponse(projectRoot, parsed, { runId, capability: run.capability });
    const resultDatabase = openRuntimeDatabase(projectRoot);
    try {
      persistValidatedResponse(resultDatabase, run, validated, reportDigest);
      const completed = safeRunProjection(resultDatabase.prepare('SELECT * FROM security_runs WHERE id = ?').get(runId));
      return { schema: 'ewai.security-run-result/v1', run: completed, assurance_notice: ASSURANCE_NOTICE };
    } finally {
      resultDatabase.close();
    }
  } catch {
    return { schema: 'ewai.security-run-result/v1', run: markRunFailed(projectRoot, runId, 'failed', 'Adapter response failed validation.'), assurance_notice: ASSURANCE_NOTICE };
  }
}

function safeArtefactPath(projectRoot, provider, signal) {
  const root = realpathSync(resolve(projectRoot));
  const providerRoot = resolve(root, provider.discovery.root);
  if (!existsSync(providerRoot) || lstatSync(providerRoot).isSymbolicLink() || !lstatSync(providerRoot).isDirectory()) return null;
  if (!isWithin(root, providerRoot) || realpathSync(providerRoot) !== providerRoot) return null;
  const candidate = resolve(providerRoot, signal);
  if (!existsSync(candidate)) return null;
  const stats = lstatSync(candidate);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > maxProviderArtefactBytes) return null;
  if (!isWithin(providerRoot, candidate) || realpathSync(candidate) !== candidate) return null;
  return relative(root, candidate).replaceAll('\\', '/');
}

function supportedArtefacts(projectRoot, provider) {
  const expected = provider.id === 'agentic-security'
    ? ['findings.json', 'last-scan.json']
    : provider.id === 'deepsec'
      ? ['report.json']
      : [];
  if (!expected.length) return [];
  const artefacts = expected.map((signal) => safeArtefactPath(projectRoot, provider, signal)).filter(Boolean);
  return artefacts.length === expected.length ? artefacts : [];
}

function stableJsonRead(projectRoot, projectRelative) {
  const root = realpathSync(resolve(projectRoot));
  const path = resolve(root, projectRelative);
  if (!isWithin(root, path) || !existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) {
    throw new Error('Security provider artefact is missing, unsafe or symbolic.');
  }
  if (realpathSync(path) !== path) throw new Error('Security provider artefact escapes the project.');
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error('Security provider artefact must be a regular file.');
    if (before.size > maxProviderArtefactBytes) throw new Error('Security provider artefact is too large.');
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('Security provider artefact changed while being read.');
    }
    return { value: JSON.parse(bytes.toString('utf8')), bytes };
  } finally {
    closeSync(descriptor);
  }
}

export function prepareSecurityArtifactImport(projectRoot, profileId, providerId, input = {}) {
  const { profile } = profileFor(projectRoot, profileId);
  if (!profile.modes.includes('artifact-import')) throw new Error(`Security profile ${profile.id} does not allow artefact import.`);
  if (profile.provider && profile.provider !== providerId) throw new Error(`Security profile ${profile.id} is configured for ${profile.provider}.`);
  const provider = securityProvider(providerId);
  if (!provider) throw new Error(`Unknown security provider: ${providerId}`);
  if (!provider.artifact_import_supported) throw new Error(`${provider.name} does not support native artefact import; use a skill handoff.`);
  if (!provider.capabilities.includes(profile.capability)) throw new Error(`${provider.name} does not declare ${profile.capability}.`);
  const revision = String(input.trustedRevision ?? '').trim();
  if (!revision || revision.length > 240 || credentialShaped(revision)) throw new Error('Security artefact import requires a safe server-resolved revision.');
  const artefacts = supportedArtefacts(projectRoot, provider);
  if (!artefacts.length) throw new Error(`${provider.name} has no complete supported artefacts to import; symbolic or partial artefacts are rejected.`);
  const token = randomUUID();
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const database = openRuntimeDatabase(projectRoot);
  try {
    database.prepare(`INSERT INTO security_discovery_tokens (id, provider_id, profile_id, artefacts_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(token, provider.id, profile.id, JSON.stringify({ artefacts, revision }), createdAt, expiresAt);
  } finally {
    database.close();
  }
  return {
    schema: 'ewai.security-artifact-import-preparation/v1',
    status: 'awaiting-import',
    token,
    provider: safeProviderProjection(provider, 'artefacts-detected', artefacts),
    profileId: profile.id,
    expiresAt,
    assurance_notice: ASSURANCE_NOTICE,
  };
}

function providerResponse(providerId, artefacts, runId, capability, expectedRevision) {
  if (providerId === 'agentic-security') {
    const findings = artefacts.find((item) => item.path.endsWith('/findings.json'))?.value;
    const scan = artefacts.find((item) => item.path.endsWith('/last-scan.json'))?.value;
    if (!Array.isArray(findings) || !scan || typeof scan !== 'object') throw new Error('Agentic Security artefacts are malformed.');
    if (String(scan.revision ?? '') !== expectedRevision) throw new Error('Agentic Security artefact revision does not match the prepared project revision.');
    return {
      schema: 'ewai.security-scan-response/v1', runId,
      status: scan.complete === true && scan.status === 'complete' ? 'complete' : 'incomplete',
      complete: scan.complete === true && scan.status === 'complete',
      capabilities: Array.isArray(scan.capabilities) ? scan.capabilities : [capability],
      findings: findings.map((finding) => ({
        id: finding.id,
        capability: finding.capability ?? capability,
        severity: finding.severity ?? 'unknown',
        confidence: finding.confidence,
        summary: finding.summary,
        locations: finding.locations ?? (finding.path ? [finding.path] : []),
        remediation: finding.remediation ?? '',
        evidence: finding.evidence ?? (finding.path ? [finding.path] : []),
      })),
      warnings: [],
    };
  }
  const report = artefacts[0]?.value;
  if (!report || typeof report !== 'object' || !Array.isArray(report.findings)) throw new Error('DeepSec artefact is malformed.');
  if (String(report.revision ?? '') !== expectedRevision) throw new Error('DeepSec artefact revision does not match the prepared project revision.');
  return {
    schema: 'ewai.security-scan-response/v1', runId,
    status: report.complete === true && report.status === 'complete' ? 'complete' : 'incomplete',
    complete: report.complete === true && report.status === 'complete',
    capabilities: Array.isArray(report.capabilities) ? report.capabilities : [capability],
    findings: report.findings,
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
  };
}

export function importSecurityArtifacts(projectRoot, token, options = {}) {
  if (!options.confirmed) throw new Error('Security artefact import requires explicit confirmation.');
  const database = openRuntimeDatabase(projectRoot);
  let discovered;
  try {
    discovered = database.prepare('SELECT * FROM security_discovery_tokens WHERE id = ?').get(String(token ?? ''));
    if (!discovered) throw new Error('Unknown security discovery token.');
    if (discovered.consumed_at) throw new Error('Security discovery token was already consumed.');
    if (Date.parse(discovered.expires_at) <= Date.now()) throw new Error('Security discovery token has expired.');
  } finally {
    database.close();
  }
  const { profile } = profileFor(projectRoot, discovered.profile_id);
  const descriptor = JSON.parse(discovered.artefacts_json);
  const artefacts = descriptor.artefacts.map((path) => ({ path, ...stableJsonRead(projectRoot, path) }));
  const runId = randomUUID();
  const response = validateScanResponse(
    projectRoot,
    providerResponse(discovered.provider_id, artefacts, runId, profile.capability, descriptor.revision),
    { runId, capability: profile.capability },
  );
  const reportDigest = sha256(Buffer.concat(artefacts.map((artefact) => artefact.bytes)));
  const timestamp = now();
  const writeDatabase = openRuntimeDatabase(projectRoot);
  try {
    writeDatabase.exec('BEGIN IMMEDIATE');
    const fresh = writeDatabase.prepare('SELECT * FROM security_discovery_tokens WHERE id = ?').get(discovered.id);
    if (!fresh || fresh.consumed_at) throw new Error('Security discovery token was already consumed.');
    writeDatabase.prepare(`
      INSERT INTO security_runs (
        id, profile_id, provider_id, interaction_mode, capability, status, revision,
        scope_json, target_class, target_ref, policy_digest, profile_snapshot_json, created_at, started_at
      ) VALUES (?, ?, ?, 'artifact-import', ?, 'importing', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId, profile.id, discovered.provider_id, profile.capability, descriptor.revision,
      JSON.stringify(profile.scope), profile.target_class, profile.target_ref,
      profileDigest(profile), JSON.stringify(profile), timestamp, timestamp,
    );
    writeDatabase.prepare('UPDATE security_discovery_tokens SET consumed_at = ? WHERE id = ?').run(timestamp, discovered.id);
    writeDatabase.exec('COMMIT');
    persistValidatedResponse(writeDatabase, { id: runId }, response, reportDigest);
    const run = safeRunProjection(writeDatabase.prepare('SELECT * FROM security_runs WHERE id = ?').get(runId));
    return { schema: 'ewai.security-artifact-import/v1', run, assurance_notice: ASSURANCE_NOTICE };
  } catch (error) {
    try { writeDatabase.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    writeDatabase.close();
  }
}

export function cancelSecurityRun(projectRoot, runId, options = {}) {
  if (!options.confirmed) throw new Error('Security run cancellation requires explicit confirmation.');
  const database = openRuntimeDatabase(projectRoot);
  try {
    const run = database.prepare('SELECT * FROM security_runs WHERE id = ?').get(runId);
    if (!run) throw new Error(`Security run not found: ${runId}`);
    if (!['prepared', 'running', 'cancelling'].includes(run.status)) throw new Error(`Security run ${runId} is already terminal.`);
    const child = activeSecurityProcesses.get(runId);
    if (child) {
      database.prepare('UPDATE security_runs SET status = ? WHERE id = ?').run('cancelling', runId);
      child.kill('SIGTERM');
    } else {
      database.prepare(`UPDATE security_runs SET status = 'cancelled', complete = 0, outcome = 'cancelled', completed_at = ? WHERE id = ?`).run(now(), runId);
    }
    return { schema: 'ewai.security-run-cancellation/v1', run: safeRunProjection(database.prepare('SELECT * FROM security_runs WHERE id = ?').get(runId)), assurance_notice: ASSURANCE_NOTICE };
  } finally {
    database.close();
  }
}

export function listSecurityRuns(projectRoot) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const runs = database.prepare('SELECT * FROM security_runs ORDER BY created_at DESC, id').all().map(safeRunProjection);
    return { schema: 'ewai.security-runs/v1', runs, assurance_notice: ASSURANCE_NOTICE };
  } finally {
    database.close();
  }
}

export function listSecurityFindings(projectRoot) {
  const database = openRuntimeDatabase(projectRoot);
  try {
    const findings = database.prepare('SELECT * FROM security_findings ORDER BY created_at DESC, finding_key').all().map(safeFindingProjection);
    return { schema: 'ewai.security-findings/v1', findings, assurance_notice: ASSURANCE_NOTICE };
  } finally {
    database.close();
  }
}

const dispositionFields = new Set([
  'decision', 'reviewer', 'reason', 'evidence', 'riskOwner', 'expiresAt', 'nextRole',
]);
const dispositionDecisions = new Set(['remediate', 'false-positive', 'accept-risk', 'escalate']);

function safeDispositionProjection(row) {
  return {
    id: row.id,
    findingId: row.finding_id,
    decision: row.decision,
    reviewer: row.reviewer,
    reason: row.reason,
    evidence: JSON.parse(row.evidence_json),
    riskOwner: row.risk_owner ?? null,
    expiresAt: row.expires_at ?? null,
    nextRole: row.next_role ?? null,
    createdAt: row.created_at,
  };
}

export function recordSecurityDisposition(projectRoot, findingId, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Security disposition must be an object.');
  strictFields(input, dispositionFields, 'Security disposition');
  const decision = String(input.decision ?? '').trim();
  if (!dispositionDecisions.has(decision)) throw new Error('Security disposition decision is invalid.');
  const reviewer = String(input.reviewer ?? '').trim();
  const reason = String(input.reason ?? '').trim();
  if (!reviewer || reviewer.length > 160 || credentialShaped(reviewer)) throw new Error('Security disposition requires a safe named reviewer.');
  if (!reason || reason.length > 2000 || credentialShaped(reason)) throw new Error('Security disposition requires a safe reason.');
  if (input.evidence !== undefined && (!Array.isArray(input.evidence) || input.evidence.length > 100)) {
    throw new Error('Security disposition evidence must be a bounded array.');
  }
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.map((value) => safeRelativeReference(projectRoot, value, 'Security disposition evidence', { requireExists: true }))
    : [];
  if (['false-positive', 'accept-risk'].includes(decision) && !evidence.length) {
    throw new Error(`${decision} disposition requires project evidence.`);
  }
  const riskOwner = String(input.riskOwner ?? '').trim();
  const expiresAt = String(input.expiresAt ?? '').trim();
  if (decision === 'accept-risk') {
    if (!riskOwner || riskOwner.length > 160 || credentialShaped(riskOwner)) throw new Error('Accepted risk requires a safe named risk owner.');
    if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
      throw new Error('Accepted risk requires a future expiry or review date.');
    }
  }
  if (decision !== 'accept-risk' && (riskOwner || expiresAt)) throw new Error('Risk owner and expiry apply only to accepted risk.');
  const nextRole = String(input.nextRole ?? '').trim();
  if (decision === 'escalate' && (!nextRole || nextRole.length > 160 || credentialShaped(nextRole))) throw new Error('Escalation requires a safe next accountable role.');
  if (decision !== 'escalate' && nextRole) throw new Error('Next accountable role applies only to escalation.');
  const database = openRuntimeDatabase(projectRoot);
  try {
    const finding = database.prepare('SELECT * FROM security_findings WHERE id = ? OR finding_key = ? ORDER BY created_at DESC LIMIT 1')
      .get(findingId, findingId);
    if (!finding) throw new Error(`Security finding not found: ${findingId}`);
    const id = randomUUID();
    const createdAt = now();
    database.prepare(`
      INSERT INTO security_dispositions (
        id, finding_id, decision, reviewer, reason, evidence_json, risk_owner, expires_at, next_role, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, finding.id, decision, reviewer, reason, JSON.stringify(evidence),
      riskOwner || null, expiresAt || null, nextRole || null, createdAt,
    );
    const row = database.prepare('SELECT * FROM security_dispositions WHERE id = ?').get(id);
    return { schema: 'ewai.security-disposition/v1', disposition: safeDispositionProjection(row), assurance_notice: ASSURANCE_NOTICE };
  } finally {
    database.close();
  }
}

export function listSecurityDispositions(projectRoot, findingId = '') {
  const database = openRuntimeDatabase(projectRoot);
  try {
    let rows;
    if (findingId) {
      const finding = database.prepare('SELECT id FROM security_findings WHERE id = ? OR finding_key = ? ORDER BY created_at DESC LIMIT 1')
        .get(findingId, findingId);
      rows = finding
        ? database.prepare('SELECT * FROM security_dispositions WHERE finding_id = ? ORDER BY created_at, id').all(finding.id)
        : [];
    } else {
      rows = database.prepare('SELECT * FROM security_dispositions ORDER BY created_at, id').all();
    }
    return { schema: 'ewai.security-dispositions/v1', dispositions: rows.map(safeDispositionProjection), assurance_notice: ASSURANCE_NOTICE };
  } finally {
    database.close();
  }
}

export function assessSecurityReadiness(projectRoot, options = {}) {
  const currentPolicy = securityPolicy(projectRoot);
  let policy = currentPolicy;
  if (options.policySnapshot) {
    const snapshot = options.policySnapshot;
    const snapshotValid = snapshot
      && snapshot.schema === 'ewai.security-policy-snapshot/v1'
      && snapshot.policy
      && snapshot.policyDigest === policyDigest(snapshot.policy);
    if (!snapshotValid) {
      return {
        schema: 'ewai.security-readiness/v1', status: 'blocked', ready: false, profiles: [],
        reasons: [{ code: 'policy-snapshot-invalid' }], assurance_notice: ASSURANCE_NOTICE,
      };
    }
    policy = snapshot.policy;
    const currentPolicyDigest = policyDigest(currentPolicy);
    if (currentPolicyDigest !== snapshot.policyDigest) {
      return {
        schema: 'ewai.security-readiness/v1',
        status: 'blocked',
        ready: false,
        profiles: policy.profiles.map((profile) => ({
          id: profile.id,
          capability: profile.capability,
          required: profile.required,
          accountableRole: profile.accountable_role,
          status: 'stale',
          run: null,
        })),
        reasons: [{ code: 'security-policy-changed', approvedPolicyDigest: snapshot.policyDigest, currentPolicyDigest }],
        assurance_notice: ASSURANCE_NOTICE,
      };
    }
  }
  if (!policy.enabled) {
    return {
      schema: 'ewai.security-readiness/v1',
      status: 'not-configured',
      ready: true,
      profiles: [],
      reasons: [],
      assurance_notice: ASSURANCE_NOTICE,
    };
  }
  const revision = String(options.trustedRevision ?? resolveSecurityRevision(projectRoot)).trim();
  const assessedAt = String(options.now ?? now());
  const assessedTime = Date.parse(assessedAt);
  if (!Number.isFinite(assessedTime)) throw new Error('Security readiness assessment time is invalid.');
  const database = openRuntimeDatabase(projectRoot);
  try {
    const profiles = [];
    const reasons = [];
    for (const profile of policy.profiles) {
      const run = database.prepare(`
        SELECT * FROM security_runs WHERE profile_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
      `).get(profile.id);
      const projection = {
        id: profile.id,
        capability: profile.capability,
        required: profile.required,
        accountableRole: profile.accountable_role,
        status: 'missing',
        run: run ? safeRunProjection(run) : null,
      };
      if (!run) {
        if (profile.required) reasons.push({ code: 'missing-evidence', profileId: profile.id, capability: profile.capability });
        profiles.push(projection);
        continue;
      }
      if (run.status !== 'complete' || !run.complete) {
        projection.status = run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'cancelled' : 'incomplete';
        if (profile.required) reasons.push({ code: 'incomplete-evidence', profileId: profile.id, status: run.status });
        profiles.push(projection);
        continue;
      }
      const currentPolicyDigest = profileDigest(profile);
      if (!run.policy_digest || run.policy_digest !== currentPolicyDigest) {
        projection.status = 'stale';
        if (profile.required) reasons.push({ code: 'policy-mismatch', profileId: profile.id, evidencePolicyDigest: run.policy_digest || null, currentPolicyDigest });
        profiles.push(projection);
        continue;
      }
      if (!revision || run.revision !== revision) {
        projection.status = 'stale';
        if (profile.required) reasons.push({ code: 'revision-mismatch', profileId: profile.id, evidenceRevision: run.revision, currentRevision: revision || null });
      }
      const completedTime = Date.parse(run.completed_at);
      if (!Number.isFinite(completedTime) || assessedTime - completedTime > profile.freshness_hours * 60 * 60 * 1000) {
        projection.status = 'stale';
        if (profile.required) reasons.push({ code: 'stale-evidence', profileId: profile.id, completedAt: run.completed_at, freshnessHours: profile.freshness_hours });
      }
      const blockingFindings = database.prepare(`
        SELECT * FROM security_findings WHERE run_id = ? AND policy_consequence = 'blocking' ORDER BY created_at, id
      `).all(run.id);
      for (const finding of blockingFindings) {
        const disposition = database.prepare(`
          SELECT * FROM security_dispositions WHERE finding_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
        `).get(finding.id);
        if (!disposition) {
          reasons.push({ code: 'blocking-finding', profileId: profile.id, findingId: finding.finding_key });
          continue;
        }
        if (disposition.decision === 'accept-risk') {
          if (!disposition.expires_at || Date.parse(disposition.expires_at) <= assessedTime) {
            reasons.push({ code: 'expired-risk-acceptance', profileId: profile.id, findingId: finding.finding_key, expiresAt: disposition.expires_at });
          }
          continue;
        }
        if (disposition.decision === 'false-positive') continue;
        reasons.push({
          code: disposition.decision === 'escalate' ? 'finding-escalated' : 'remediation-pending',
          profileId: profile.id,
          findingId: finding.finding_key,
        });
      }
      const findingBlocked = reasons.some((reason) => (
        reason.profileId === profile.id
        && ['blocking-finding', 'expired-risk-acceptance', 'finding-escalated', 'remediation-pending'].includes(reason.code)
      ));
      projection.status = findingBlocked ? 'blocked' : projection.status === 'stale' ? 'stale' : 'current';
      profiles.push(projection);
    }
    const blockingReasons = reasons.filter((reason) => policy.profiles.find((profile) => profile.id === reason.profileId)?.required !== false);
    return {
      schema: 'ewai.security-readiness/v1',
      status: blockingReasons.length ? 'blocked' : 'ready',
      ready: blockingReasons.length === 0,
      assessedAt,
      revision: revision || null,
      profiles,
      reasons,
      assurance_notice: ASSURANCE_NOTICE,
    };
  } finally {
    database.close();
  }
}

export function resolveSecurityRevision(projectRoot) {
  try {
    const root = resolve(projectRoot);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
    const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: maxRevisionDiffBytes,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
    if (!status.length) return head;
    const diff = execFileSync('git', ['diff', '--binary', '--no-ext-diff', 'HEAD', '--'], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: maxRevisionDiffBytes,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: maxRevisionDiffBytes,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).toString('utf8').split('\0').filter(Boolean);
    const hash = createHash('sha256');
    hash.update(head);
    hash.update(status);
    hash.update(diff);
    let untrackedBytes = 0;
    for (const projectRelative of untracked.sort()) {
      const path = resolve(root, projectRelative);
      if (!isWithin(root, path)) throw new Error('Untracked revision path escapes the project.');
      const stats = lstatSync(path);
      hash.update(`${Buffer.byteLength(projectRelative)}:${projectRelative}:${stats.mode & 0o777}:`);
      if (stats.isSymbolicLink()) {
        hash.update(`link:${readlinkSync(path)}`);
      } else if (stats.isFile()) {
        untrackedBytes += stats.size;
        if (untrackedBytes > maxRevisionDiffBytes) throw new Error('Untracked revision content exceeds the safe limit.');
        hash.update(readFileSync(path));
      }
    }
    return `${head}:worktree-sha256:${hash.digest('hex')}`;
  } catch {
    return '';
  }
}

export function readSecurityWorkspace(projectRoot, options = {}) {
  const policy = securityPolicy(projectRoot);
  const providers = discoverSecurityProviders(projectRoot).providers;
  const adapters = listSecurityAdapters(projectRoot).adapters;
  const runs = listSecurityRuns(projectRoot).runs;
  const findings = listSecurityFindings(projectRoot).findings;
  const dispositions = listSecurityDispositions(projectRoot).dispositions;
  const readiness = assessSecurityReadiness(projectRoot, {
    trustedRevision: options.trustedRevision ?? resolveSecurityRevision(projectRoot),
    now: options.now,
  });
  const signals = [
    'security', 'risk', 'privacy', 'source code', 'release',
    ...readiness.profiles.filter((profile) => profile.status !== 'current').map((profile) => profile.capability),
    ...findings.filter((finding) => finding.policyConsequence === 'blocking').map((finding) => finding.summary),
  ];
  const activePersonas = selectContextualPersonas({
    signals,
    context: { readiness: readiness.status, capabilities: policy.profiles.map((profile) => profile.capability) },
    contextLabel: 'security evidence, findings and release consequence',
    personaCatalogue: options.personas ?? [],
    limit: 5,
  });
  return {
    schema: 'ewai.security-workspace/v1',
    assurance_notice: ASSURANCE_NOTICE,
    policy,
    readiness,
    providers,
    adapters,
    runs,
    findings: findings.map((finding) => ({
      ...finding,
      dispositions: dispositions.filter((disposition) => disposition.findingId === finding.recordId),
    })),
    active_personas: activePersonas,
  };
}
