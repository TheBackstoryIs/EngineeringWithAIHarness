import { isAbsolute } from 'node:path';

export const ASSURANCE_NOTICE = 'Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.';

export const SECURITY_CAPABILITIES = Object.freeze([
  'source-static',
  'dependency-sbom',
  'secret-detection',
  'infrastructure-configuration',
  'llm-runtime-red-team',
]);

export const SECURITY_INTERACTION_MODES = Object.freeze(['command', 'skill', 'artifact-import']);

export const SECURITY_PROVIDER_CATALOGUE = Object.freeze([
  Object.freeze({
    id: 'agentic-security',
    name: 'Agentic Security',
    publisher: 'Clear Capabilities',
    official_sources: Object.freeze(['https://github.com/Clear-Capabilities/agentic-security']),
    capabilities: Object.freeze([...SECURITY_CAPABILITIES]),
    artifact_import_supported: true,
    summary: 'Security analysis across source, dependencies, secrets, infrastructure, agent and LLM surfaces, with reporting and remediation workflows.',
    cautions: Object.freeze([
      'EWAI does not install, redistribute, license or endorse this provider.',
      'Review the provider licence before repackaging, resale or use in a competing scanner.',
      'Automated findings can be incomplete or false positive and require qualified human review.',
    ]),
    discovery: Object.freeze({ root: '.agentic-security', signals: Object.freeze(['findings.json', 'last-scan.json']) }),
  }),
  Object.freeze({
    id: 'deepsec',
    name: 'DeepSec',
    publisher: 'Vercel Labs',
    official_sources: Object.freeze([
      'https://github.com/vercel-labs/deepsec',
      'https://www.npmjs.com/package/deepsec',
    ]),
    capabilities: Object.freeze(['source-static', 'secret-detection']),
    artifact_import_supported: true,
    summary: 'Agent-powered source vulnerability investigation with resumable scans, revalidation, diff review and Markdown or JSON reporting.',
    cautions: Object.freeze([
      'EWAI does not install, configure, license or endorse this provider.',
      'Model use can be expensive on large repositories and the tool should be trusted like a coding agent with shell access.',
      'Optional sandbox execution can upload a working-tree archive; review data handling before use.',
    ]),
    discovery: Object.freeze({ root: '.deepsec', signals: Object.freeze(['report.json', 'run.json', 'runs', 'reports']) }),
  }),
  Object.freeze({
    id: 'visa-vvah',
    name: 'Visa Vulnerability Agentic Harness (VVAH)',
    publisher: 'Visa',
    official_sources: Object.freeze(['https://github.com/visa/visa-vulnerability-agentic-harness']),
    capabilities: Object.freeze(['source-static']),
    artifact_import_supported: false,
    summary: 'Threat-modelled agentic source vulnerability discovery and structured reporting, with optional upstream remediation and validation stages.',
    cautions: Object.freeze([
      'EWAI does not install, invoke, redistribute, license or endorse this provider.',
      'Use detection-only mode with vvaharness scan --repo <path> --stop-after s9; the upstream default can continue into remediation and edit target source.',
      'VVAH can send source-derived prompt data to configured model providers, uses elevated local privileges, can be token-intensive and produces nondeterministic triage candidates requiring qualified human review.',
      'Native VVAH artefact import is not supported; use the revision-bound skill handoff and an organisation-controlled translator to ewai.security-scan-response/v1.',
    ]),
    discovery: Object.freeze({ root: '.', signals: Object.freeze(['security-scan', 'run_manifest.json']) }),
  }),
]);

const configFields = new Set(['enabled', 'profiles']);
const profileFields = new Set([
  'id', 'capability', 'required', 'freshness_hours', 'timeout_seconds', 'accountable_role',
  'modes', 'provider', 'adapter', 'checkpoint', 'thresholds', 'scope', 'target_class', 'target_ref',
]);
const profileIdPattern = /^[a-z][a-z0-9-]{1,63}$/;
const adapterIdPattern = /^[a-z][a-z0-9.-]{1,79}$/;
const thresholdFields = new Set(['blocking_severities']);
const scopeFields = new Set(['include', 'exclude']);
const securitySeverities = Object.freeze(['critical', 'high', 'medium', 'low', 'info', 'unknown']);
const targetClasses = new Set(['local', 'development', 'test', 'staging', 'production']);

function credentialShaped(value) {
  return /(?:Bearer\s+[A-Za-z0-9._~+\/-]{12,}|sk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(String(value ?? ''));
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function rejectUnknown(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field: ${key}`);
  }
}

function boundedInteger(value, label, minimum, maximum, fallback) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return selected;
}

function normaliseThresholds(value) {
  if (value === undefined) return { blocking_severities: ['critical', 'high'] };
  assertObject(value, 'Security profile thresholds');
  rejectUnknown(value, thresholdFields, 'Security profile thresholds');
  const severities = value.blocking_severities ?? ['critical', 'high'];
  if (!Array.isArray(severities) || !severities.length || severities.length > securitySeverities.length) {
    throw new Error('Security profile blocking_severities must be a non-empty severity array.');
  }
  const normalised = severities.map((severity) => String(severity).trim().toLowerCase());
  if (new Set(normalised).size !== normalised.length || normalised.some((severity) => !securitySeverities.includes(severity))) {
    throw new Error('Security profile blocking_severities contains a duplicate or unsupported severity.');
  }
  return { blocking_severities: normalised };
}

function normaliseScopeList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${label} must be an array of at most 100 project-relative paths.`);
  const seen = new Set();
  return value.map((candidate) => {
    const path = String(candidate ?? '').trim().replaceAll('\\', '/');
    if (!path || path.length > 240 || credentialShaped(path) || isAbsolute(path) || path === '..' || path.startsWith('../') || path.includes('/../')) {
      throw new Error(`${label} must contain safe project-relative paths.`);
    }
    if (seen.has(path)) throw new Error(`${label} contains a duplicate path: ${path}`);
    seen.add(path);
    return path;
  });
}

function normaliseScope(value) {
  if (value === undefined) return { include: [], exclude: [] };
  assertObject(value, 'Security profile scope');
  rejectUnknown(value, scopeFields, 'Security profile scope');
  return {
    include: normaliseScopeList(value.include, 'Security profile scope.include'),
    exclude: normaliseScopeList(value.exclude, 'Security profile scope.exclude'),
  };
}

function normaliseProfile(profile, seen) {
  assertObject(profile, 'Security profile');
  rejectUnknown(profile, profileFields, 'Security profile');
  const id = String(profile.id ?? '').trim();
  if (!profileIdPattern.test(id)) throw new Error('Security profile id must be lower-kebab-case and 2-64 characters.');
  if (seen.has(id)) throw new Error(`Duplicate profile id: ${id}`);
  seen.add(id);
  const capability = String(profile.capability ?? '').trim();
  if (!SECURITY_CAPABILITIES.includes(capability)) throw new Error(`Unsupported security capability: ${capability || '(empty)'}`);
  const required = profile.required !== false;
  const accountableRole = String(profile.accountable_role ?? '').trim();
  if (!accountableRole || accountableRole.length > 120 || credentialShaped(accountableRole)) throw new Error(`Security profile ${id} requires a bounded accountable_role.`);
  if (required && profile.freshness_hours === undefined) throw new Error(`Required security profile ${id} requires freshness_hours.`);
  const freshnessHours = boundedInteger(profile.freshness_hours, `${id}.freshness_hours`, 1, 8760, 168);
  const timeoutSeconds = boundedInteger(profile.timeout_seconds, `${id}.timeout_seconds`, 1, 3600, 300);
  const modes = profile.modes === undefined ? [...SECURITY_INTERACTION_MODES] : profile.modes;
  if (!Array.isArray(modes) || !modes.length || modes.some((mode) => !SECURITY_INTERACTION_MODES.includes(mode))) {
    throw new Error(`Security profile ${id} modes must contain supported interaction modes.`);
  }
  if (new Set(modes).size !== modes.length) throw new Error(`Security profile ${id} contains duplicate interaction modes.`);
  const provider = String(profile.provider ?? '').trim();
  if (profile.provider !== undefined && !provider) throw new Error(`Security profile ${id} provider is invalid.`);
  if (provider && !SECURITY_PROVIDER_CATALOGUE.some((candidate) => candidate.id === provider)) {
    throw new Error(`Unknown security provider: ${provider}`);
  }
  const providerDefinition = provider ? securityProvider(provider) : null;
  if (providerDefinition?.artifact_import_supported === false && modes.includes('artifact-import')) {
    throw new Error(`${providerDefinition.name} does not support native artefact import; use a skill handoff.`);
  }
  const adapter = profile.adapter ? String(profile.adapter).trim() : '';
  if (profile.adapter !== undefined && !adapter) throw new Error(`Security profile ${id} adapter identity is invalid.`);
  if (adapter && !adapterIdPattern.test(adapter)) throw new Error(`Security profile ${id} adapter identity is invalid.`);
  const checkpoint = String(profile.checkpoint ?? 'release').trim();
  if (!checkpoint || checkpoint.length > 80) throw new Error(`Security profile ${id} checkpoint is invalid.`);
  const targetClass = profile.target_class ? String(profile.target_class).trim() : '';
  if (profile.target_class !== undefined && !targetClass) throw new Error(`Security profile ${id} target_class is invalid.`);
  if (targetClass && !targetClasses.has(targetClass)) throw new Error(`Security profile ${id} target_class is invalid.`);
  const targetRef = profile.target_ref ? String(profile.target_ref).trim() : '';
  if (profile.target_ref !== undefined && !targetRef) throw new Error(`Security profile ${id} target_ref is invalid.`);
  if (targetRef.length > 160 || credentialShaped(targetRef)) throw new Error(`Security profile ${id} target_ref is unsafe.`);
  return {
    id,
    capability,
    required,
    freshness_hours: freshnessHours,
    timeout_seconds: timeoutSeconds,
    accountable_role: accountableRole,
    modes: [...modes],
    provider: provider || null,
    adapter: adapter || null,
    checkpoint,
    thresholds: normaliseThresholds(profile.thresholds),
    scope: normaliseScope(profile.scope),
    target_class: targetClass || null,
    target_ref: targetRef || null,
  };
}

export function normaliseSecurityValidationConfig(config = {}) {
  assertObject(config, 'Project configuration');
  const raw = config.security_validation;
  if (raw === undefined || raw === null || raw === false) {
    return { schema: 'ewai.security-policy/v1', status: 'not-configured', enabled: false, profiles: [], assurance_notice: ASSURANCE_NOTICE };
  }
  assertObject(raw, 'security_validation');
  rejectUnknown(raw, configFields, 'security_validation');
  if (raw.enabled === false) {
    return { schema: 'ewai.security-policy/v1', status: 'not-configured', enabled: false, profiles: [], assurance_notice: ASSURANCE_NOTICE };
  }
  if (raw.enabled !== true) throw new Error('security_validation.enabled must be true or false.');
  if (!Array.isArray(raw.profiles) || !raw.profiles.length) throw new Error('Enabled security validation requires at least one profile.');
  const seen = new Set();
  return {
    schema: 'ewai.security-policy/v1',
    status: 'configured',
    enabled: true,
    profiles: raw.profiles.map((profile) => normaliseProfile(profile, seen)),
    assurance_notice: ASSURANCE_NOTICE,
  };
}

export function securityProvider(providerId) {
  return SECURITY_PROVIDER_CATALOGUE.find((provider) => provider.id === providerId) ?? null;
}
