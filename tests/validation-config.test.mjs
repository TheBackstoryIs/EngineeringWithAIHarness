import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveValidationConfig,
  normaliseValidationConfig,
  setValidationCheckpoint,
  setValidationProvider,
} from '../src/validation-config.mjs';

test('normalises legacy provider flags without weakening mandatory standards', () => {
  const validation = normaliseValidationConfig({
    external: {
      policy: 'available-only',
      providers: {
        codex: 'available',
        gemini: 'unavailable',
      },
    },
  });

  assert.deepEqual(validation.external.providers.codex, {
    state: 'available',
    enabled: true,
  });
  assert.deepEqual(validation.external.providers.claude, {
    state: 'unavailable',
    enabled: false,
  });
  assert.deepEqual(validation.external.providers.antigravity, {
    state: 'unavailable',
    enabled: false,
  });
  assert.equal('gemini' in validation.external.providers, false);
  assert.deepEqual(validation.standards, {
    required: true,
    allow_waiver: false,
  });
});

test('selects validators per checkpoint and excludes the active orchestrator', () => {
  const config = { validation: normaliseValidationConfig() };
  setValidationProvider(config, 'claude', 'available', true);
  setValidationProvider(config, 'codex', 'available', true);
  setValidationProvider(config, 'antigravity', 'available', false);
  setValidationCheckpoint(config, 'implementation-plan', {
    validators: ['claude', 'codex', 'antigravity'],
    max_cycles: 3,
    review: {
      breadth: 'system',
      depth: 'analysis-and-recommendations',
      output: 'large',
    },
  });

  const effective = effectiveValidationConfig(config, 'codex');
  assert.deepEqual(effective.checkpoints['implementation-plan'].validators, ['claude']);
  assert.equal(effective.checkpoints['implementation-plan'].skipped_orchestrator, 'codex');
  assert.equal(effective.checkpoints['implementation-plan'].max_cycles, 3);
  assert.deepEqual(effective.checkpoints['implementation-plan'].review, {
    breadth: 'system',
    depth: 'analysis-and-recommendations',
    output: 'large',
  });
});

test('migrates legacy Gemini provider selections to Antigravity without enabling access', () => {
  const validation = normaliseValidationConfig({
    external: {
      providers: {
        gemini: { state: 'available', enabled: false },
      },
      checkpoints: {
        code: { validators: ['gemini'] },
      },
    },
  });

  assert.deepEqual(validation.external.providers.antigravity, {
    state: 'available',
    enabled: false,
  });
  assert.deepEqual(validation.external.checkpoints.code.validators, ['antigravity']);
  assert.equal('gemini' in validation.external.providers, false);
});

test('a single configured coding system does not masquerade as independent validation', () => {
  const config = { validation: normaliseValidationConfig() };
  setValidationProvider(config, 'claude', 'available', true);
  const effective = effectiveValidationConfig(config, 'claude');
  assert.deepEqual(effective.checkpoints.code.validators, []);
  assert.equal(effective.standards.required, true);
});

test('rejects attempts to disable or waive standards compliance', () => {
  assert.throws(
    () => normaliseValidationConfig({ standards: { required: false } }),
    /mandatory and cannot be disabled/,
  );
  assert.throws(
    () => normaliseValidationConfig({ standards: { allow_waiver: true } }),
    /cannot be waived/,
  );
  assert.throws(
    () => normaliseValidationConfig({
      external: {
        checkpoints: {
          code: { max_cycles: 4 },
        },
      },
    }),
    /integer from 1 to 3/,
  );
});
