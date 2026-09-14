import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { initProject } from '../src/project.mjs';
import {
  ASSURANCE_NOTICE,
  SECURITY_CAPABILITIES,
  SECURITY_PROVIDER_CATALOGUE,
  normaliseSecurityValidationConfig,
} from '../src/security-validation-config.mjs';
import { openRuntimeDatabase } from '../src/runtime/database.mjs';
import {
  discoverSecurityProviders,
  listSecurityAdapters,
  prepareSecuritySkillHandoff,
  registerSecurityAdapter,
  resolveSecurityRevision,
  validateSecurityAdapter,
} from '../src/runtime/security-validation.mjs';

function createProject(name = 'Security Validation Test') {
  const root = mkdtempSync(resolve(tmpdir(), 'ewai-security-validation-'));
  initProject(root, { name });
  return root;
}

function createAdapter(root, overrides = {}) {
  const adapterRoot = resolve(root, 'trusted-adapter');
  mkdirSync(adapterRoot, { recursive: true });
  const marker = resolve(root, 'adapter-executed');
  writeFileSync(resolve(adapterRoot, 'adapter.mjs'), `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\n`);
  chmodSync(resolve(adapterRoot, 'adapter.mjs'), 0o755);
  writeFileSync(resolve(adapterRoot, 'security-adapter.json'), `${JSON.stringify({
    schema: 'ewai.security-adapter/v1',
    id: 'fixture.security',
    name: 'Fixture Security Adapter',
    publisher: { id: 'fixture', name: 'Fixture Publisher' },
    version: '1.0.0',
    protocolVersion: '1',
    capabilities: ['source-static', 'secret-detection'],
    entrypoint: 'adapter.mjs',
    ...overrides,
  }, null, 2)}\n`);
  return { adapterRoot, marker };
}

test('normalises an optional strict capability policy and always projects the assurance notice', () => {
  const missing = normaliseSecurityValidationConfig({});
  assert.equal(missing.status, 'not-configured');
  assert.equal(missing.assurance_notice, ASSURANCE_NOTICE);
  assert.deepEqual(SECURITY_CAPABILITIES, [
    'source-static',
    'dependency-sbom',
    'secret-detection',
    'infrastructure-configuration',
    'llm-runtime-red-team',
  ]);

  const configured = normaliseSecurityValidationConfig({
    security_validation: {
      enabled: true,
      profiles: [{
        id: 'source',
        capability: 'source-static',
        required: true,
        freshness_hours: 24,
        timeout_seconds: 120,
        accountable_role: 'Security Lead',
        modes: ['command', 'skill', 'artifact-import'],
      }],
    },
  });
  assert.equal(configured.status, 'configured');
  assert.equal(configured.profiles[0].capability, 'source-static');
  assert.deepEqual(configured.profiles[0].thresholds, { blocking_severities: ['critical', 'high'] });
  assert.deepEqual(configured.profiles[0].scope, { include: [], exclude: [] });
  assert.equal(configured.assurance_notice, ASSURANCE_NOTICE);

  const visa = normaliseSecurityValidationConfig({
    security_validation: {
      enabled: true,
      profiles: [{
        id: 'visa-source-review',
        capability: 'source-static',
        required: true,
        freshness_hours: 24,
        accountable_role: 'Security Lead',
        modes: ['skill'],
        provider: 'visa-vvah',
      }],
    },
  });
  assert.equal(visa.profiles[0].provider, 'visa-vvah');
  assert.deepEqual(visa.profiles[0].modes, ['skill']);
  const policySchema = JSON.parse(readFileSync(resolve(import.meta.dirname, '../config/security-validation-policy.schema.json'), 'utf8'));
  assert.equal(policySchema.properties.profiles.items.properties.provider.enum.includes('visa-vvah'), true);

  assert.throws(() => normaliseSecurityValidationConfig({ security_validation: { enabled: true, unknown: true, profiles: [] } }), /unknown field/i);
  assert.throws(() => normaliseSecurityValidationConfig({ security_validation: { enabled: true, profiles: [
    { id: 'same', capability: 'source-static', required: true, freshness_hours: 24, timeout_seconds: 60, accountable_role: 'Lead' },
    { id: 'same', capability: 'secret-detection', required: true, freshness_hours: 24, timeout_seconds: 60, accountable_role: 'Lead' },
  ] } }), /duplicate profile/i);
  assert.throws(() => normaliseSecurityValidationConfig({ security_validation: { enabled: true, profiles: [
    { id: 'source', capability: 'unknown', required: true, freshness_hours: 24, timeout_seconds: 60, accountable_role: 'Lead' },
  ] } }), /unsupported security capability/i);
  assert.throws(() => normaliseSecurityValidationConfig({ security_validation: { enabled: true, profiles: [
    { id: 'source', capability: 'source-static', required: true, freshness_hours: 24, accountable_role: 'Lead', thresholds: { blocking_severities: [] } },
  ] } }), /blocking_severities/i);
  assert.throws(() => normaliseSecurityValidationConfig({ security_validation: { enabled: true, profiles: [
    { id: 'source', capability: 'source-static', required: true, freshness_hours: 24, accountable_role: 'Lead', scope: { include: ['../outside'] } },
  ] } }), /project-relative paths/i);
  assert.throws(() => normaliseSecurityValidationConfig({ security_validation: { enabled: true, profiles: [
    { id: 'runtime', capability: 'llm-runtime-red-team', required: true, freshness_hours: 24, accountable_role: 'Lead', target_class: 'arbitrary' },
  ] } }), /target_class/i);
  assert.throws(() => normaliseSecurityValidationConfig({ security_validation: { enabled: true, profiles: [
    { id: 'visa-source', capability: 'source-static', required: true, freshness_hours: 24, accountable_role: 'Lead', modes: ['artifact-import'], provider: 'visa-vvah' },
  ] } }), /does not support native artefact import/i);
});

test('exposes conservative fixed provider guidance and discovers only project-local supported signals', () => {
  const root = createProject();
  const outside = mkdtempSync(resolve(tmpdir(), 'ewai-security-outside-'));
  try {
    assert.deepEqual(SECURITY_PROVIDER_CATALOGUE.map((provider) => provider.id), ['agentic-security', 'deepsec', 'visa-vvah']);
    const absent = discoverSecurityProviders(root);
    assert.equal(absent.assurance_notice, ASSURANCE_NOTICE);
    assert.equal(absent.providers.every((provider) => provider.state === 'not-detected'), true);
    assert.equal(absent.providers[0].official_sources[0], 'https://github.com/Clear-Capabilities/agentic-security');
    assert.deepEqual(absent.providers[1].official_sources, [
      'https://github.com/vercel-labs/deepsec',
      'https://www.npmjs.com/package/deepsec',
    ]);
    assert.deepEqual(absent.providers[2].official_sources, [
      'https://github.com/visa/visa-vulnerability-agentic-harness',
    ]);
    assert.deepEqual(absent.providers[2].capabilities, ['source-static']);
    assert.equal(absent.providers[2].artifact_import_supported, false);
    assert.equal(absent.providers[2].cautions.some((caution) => caution.includes('--stop-after s9')), true);

    mkdirSync(resolve(root, '.agentic-security'), { recursive: true });
    writeFileSync(resolve(root, '.agentic-security/findings.json'), '[]\n');
    mkdirSync(resolve(root, '.deepsec'), { recursive: true });
    writeFileSync(resolve(root, '.deepsec/report.json'), '{}\n');
    mkdirSync(resolve(root, 'security-scan'), { recursive: true });
    writeFileSync(resolve(root, 'security-scan/module_report.sarif'), '{}\n');
    const detected = discoverSecurityProviders(root);
    assert.deepEqual(detected.providers.map((provider) => provider.state), ['artefacts-detected', 'artefacts-detected', 'artefacts-detected']);
    assert.equal(detected.providers.every((provider) => provider.capabilities.length > 0 && provider.cautions.length > 0), true);

    rmSync(resolve(root, '.deepsec'), { recursive: true, force: true });
    mkdirSync(resolve(outside, '.deepsec'), { recursive: true });
    symlinkSync(resolve(outside, '.deepsec'), resolve(root, '.deepsec'));
    assert.equal(discoverSecurityProviders(root).providers[1].state, 'not-detected');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('validates and explicitly registers a trusted command adapter without executing it', () => {
  const root = createProject();
  try {
    const { adapterRoot, marker } = createAdapter(root);
    writeFileSync(resolve(adapterRoot, 'helper.mjs'), 'export const value = 1;\n');
    const validation = validateSecurityAdapter(root, adapterRoot);
    assert.equal(validation.valid, true);
    assert.equal(validation.adapter.id, 'fixture.security');
    assert.equal(validation.adapter.entrypoint, undefined);
    assert.equal(readFileSync(resolve(adapterRoot, 'security-adapter.json'), 'utf8').includes(marker), false);
    assert.throws(() => readFileSync(marker), /ENOENT/);
    assert.throws(() => registerSecurityAdapter(root, adapterRoot), /explicit confirmation/i);

    const registered = registerSecurityAdapter(root, adapterRoot, { confirmed: true });
    assert.equal(registered.assurance_notice, ASSURANCE_NOTICE);
    assert.equal(registered.adapter.id, 'fixture.security');
    assert.equal(registered.adapter.entrypoint, undefined);
    assert.equal(listSecurityAdapters(root).adapters[0].id, 'fixture.security');
    assert.throws(() => readFileSync(marker), /ENOENT/);

    writeFileSync(resolve(adapterRoot, 'helper.mjs'), 'export const value = 2;\n');
    assert.throws(() => registerSecurityAdapter(root, adapterRoot, { confirmed: true }), /digest drift|already registered/i);

    const manifestPath = resolve(adapterRoot, 'security-adapter.json');
    const revisedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    revisedManifest.version = '1.0.1';
    writeFileSync(manifestPath, `${JSON.stringify(revisedManifest, null, 2)}\n`);
    const revised = registerSecurityAdapter(root, adapterRoot, { confirmed: true });
    assert.equal(revised.adapter.version, '1.0.1');
    assert.notEqual(revised.adapter.packageDigest, registered.adapter.packageDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepares a provider skill handoff without creating security evidence', () => {
  const root = createProject();
  try {
    const prepared = prepareSecuritySkillHandoff(root, {
      providerId: 'deepsec',
      profileId: 'source',
      capability: 'source-static',
      revision: 'abc123',
      scope: ['src/'],
    });
    assert.equal(prepared.status, 'awaiting-evidence');
    assert.equal(prepared.evidence, null);
    assert.equal(prepared.assurance_notice, ASSURANCE_NOTICE);
    assert.equal(prepared.handoff.provider.id, 'deepsec');

    const visa = prepareSecuritySkillHandoff(root, {
      providerId: 'visa-vvah',
      profileId: 'visa-source',
      capability: 'source-static',
      revision: 'def456',
      scope: ['src/', 'packages/api/'],
    });
    assert.equal(visa.status, 'awaiting-evidence');
    assert.equal(visa.evidence, null);
    assert.equal(visa.handoff.provider.id, 'visa-vvah');
    assert.equal(visa.handoff.provider.artifact_import_supported, false);
    assert.equal(visa.handoff.revision, 'def456');
    assert.deepEqual(visa.handoff.scope, ['src/', 'packages/api/']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('documents the bounded Visa VVAH skill handoff and security-intent route', () => {
  const guide = readFileSync(resolve(import.meta.dirname, '../Docs/security-validation-guide.md'), 'utf8');
  const dashboard = readFileSync(resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  assert.match(guide, /Visa Vulnerability Agentic Harness \(VVAH\)/);
  assert.match(guide, /--stop-after s9/);
  assert.match(guide, /security intent/i);
  assert.match(guide, /does not install[\s\S]{0,80}invoke[\s\S]{0,80}VVAH/i);
  assert.match(guide, /does not offer the native import action/i);
  assert.match(dashboard, /provider\.artifact_import_supported && provider\.state === 'artefacts-detected'/);
});

test('creates security storage idempotently without changing existing runtime rows', () => {
  const root = createProject();
  try {
    const first = openRuntimeDatabase(root);
    first.prepare("INSERT INTO runtime_meta (key, value) VALUES ('fixture', 'preserve-me')").run();
    first.close();
    const second = openRuntimeDatabase(root);
    const tables = second.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'security_%' ORDER BY name").all().map((row) => row.name);
    assert.deepEqual(tables, [
      'security_adapters',
      'security_attempts',
      'security_discovery_tokens',
      'security_dispositions',
      'security_findings',
      'security_runs',
    ]);
    assert.equal(second.prepare("SELECT value FROM runtime_meta WHERE key = 'fixture'").get().value, 'preserve-me');
    second.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binds security evidence to committed and changing working-tree content', () => {
  const root = createProject('Security Revision Test');
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'security-test@example.test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Security Test'], { cwd: root });
    writeFileSync(resolve(root, 'source.mjs'), 'export const value = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'Initial fixture'], { cwd: root });

    const clean = resolveSecurityRevision(root);
    assert.match(clean, /^[a-f0-9]{40}$/);
    writeFileSync(resolve(root, 'source.mjs'), 'export const value = 2;\n');
    const firstDirty = resolveSecurityRevision(root);
    assert.match(firstDirty, /^[a-f0-9]{40}:worktree-sha256:[a-f0-9]{64}$/);
    writeFileSync(resolve(root, 'source.mjs'), 'export const value = 3;\n');
    const secondDirty = resolveSecurityRevision(root);
    assert.notEqual(secondDirty, firstDirty);
    writeFileSync(resolve(root, 'untracked.mjs'), 'export const extra = true;\n');
    assert.notEqual(resolveSecurityRevision(root), secondDirty);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
