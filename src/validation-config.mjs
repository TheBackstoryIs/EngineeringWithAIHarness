export const VALIDATION_PROVIDERS = Object.freeze(['claude', 'codex', 'antigravity']);

const LEGACY_PROVIDER_ALIASES = Object.freeze({
  gemini: 'antigravity',
  agy: 'antigravity',
});

export function canonicalValidationProvider(provider) {
  const value = String(provider ?? '').trim().toLowerCase();
  return LEGACY_PROVIDER_ALIASES[value] ?? value;
}

export const VALIDATION_CHECKPOINTS = Object.freeze({
  'implementation-plan': 'validate-external-plan',
  'test-plan': 'validate-external-test-plan',
  code: 'validate-external-code',
});

export const VALIDATION_BREADTHS = Object.freeze([
  'targeted',
  'change-set',
  'capability',
  'system',
]);

export const VALIDATION_DEPTHS = Object.freeze([
  'issues-only',
  'issues-and-fixes',
  'analysis-and-recommendations',
]);

export const VALIDATION_OUTPUTS = Object.freeze(['small', 'medium', 'large']);

const DEFAULT_CHECKPOINTS = Object.freeze({
  'implementation-plan': {
    enabled: true,
    max_cycles: 2,
    validators: 'auto',
    review: {
      breadth: 'capability',
      depth: 'issues-and-fixes',
      output: 'medium',
    },
  },
  'test-plan': {
    enabled: true,
    max_cycles: 2,
    validators: 'auto',
    review: {
      breadth: 'capability',
      depth: 'issues-and-fixes',
      output: 'medium',
    },
  },
  code: {
    enabled: true,
    max_cycles: 2,
    validators: 'auto',
    review: {
      breadth: 'change-set',
      depth: 'issues-and-fixes',
      output: 'medium',
    },
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function normaliseProvider(value, provider) {
  if (typeof value === 'string') {
    requireEnum(value, ['available', 'unavailable'], `validation provider ${provider}`);
    return {
      state: value,
      enabled: value === 'available',
    };
  }

  const state = value?.state ?? 'unavailable';
  requireEnum(state, ['available', 'unavailable'], `validation provider ${provider} state`);
  if (value?.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error(`validation provider ${provider} enabled must be true or false`);
  }
  const enabled = state === 'available' && (value?.enabled ?? true);

  return { state, enabled };
}

function normaliseValidators(value, checkpoint) {
  if (value === undefined || value === 'auto') {
    return 'auto';
  }
  if (!Array.isArray(value)) {
    throw new Error(`validation checkpoint ${checkpoint} validators must be "auto" or an array`);
  }

  const validators = [...new Set(value.map(canonicalValidationProvider))];
  for (const provider of validators) {
    requireEnum(provider, VALIDATION_PROVIDERS, `validation checkpoint ${checkpoint} validator`);
  }
  return validators;
}

function normaliseCheckpoint(value, checkpoint) {
  const defaults = DEFAULT_CHECKPOINTS[checkpoint];
  const review = value?.review ?? {};
  if (value?.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error(`validation checkpoint ${checkpoint} enabled must be true or false`);
  }
  const maxCycles = value?.max_cycles ?? defaults.max_cycles;
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 3) {
    throw new Error(`validation checkpoint ${checkpoint} max_cycles must be an integer from 1 to 3`);
  }

  return {
    enabled: value?.enabled ?? defaults.enabled,
    max_cycles: maxCycles,
    validators: normaliseValidators(value?.validators, checkpoint),
    review: {
      breadth: requireEnum(
        review.breadth ?? defaults.review.breadth,
        VALIDATION_BREADTHS,
        `validation checkpoint ${checkpoint} review breadth`,
      ),
      depth: requireEnum(
        review.depth ?? defaults.review.depth,
        VALIDATION_DEPTHS,
        `validation checkpoint ${checkpoint} review depth`,
      ),
      output: requireEnum(
        review.output ?? defaults.review.output,
        VALIDATION_OUTPUTS,
        `validation checkpoint ${checkpoint} review output`,
      ),
    },
  };
}

export function defaultValidationConfig() {
  return {
    standards: {
      required: true,
      allow_waiver: false,
    },
    external: {
      policy: 'configured',
      independent_only: true,
      providers: Object.fromEntries(
        VALIDATION_PROVIDERS.map((provider) => [
          provider,
          { state: 'unavailable', enabled: false },
        ]),
      ),
      checkpoints: clone(DEFAULT_CHECKPOINTS),
    },
  };
}

export function normaliseValidationConfig(value = {}) {
  if (value?.standards?.required === false) {
    throw new Error('Standards compliance is mandatory and cannot be disabled');
  }
  if (value?.standards?.allow_waiver === true) {
    throw new Error('Standards compliance cannot be waived');
  }
  if (value?.external?.independent_only === false) {
    throw new Error('External validation must remain independent of the orchestrator');
  }

  const rawProviders = value?.external?.providers ?? {};
  const providers = Object.fromEntries(
    VALIDATION_PROVIDERS.map((provider) => [
      provider,
      normaliseProvider(
        rawProviders[provider] ?? (provider === 'antigravity' ? rawProviders.gemini : undefined),
        provider,
      ),
    ]),
  );

  const rawCheckpoints = value?.external?.checkpoints ?? {};
  const checkpoints = Object.fromEntries(
    Object.keys(VALIDATION_CHECKPOINTS).map((checkpoint) => [
      checkpoint,
      normaliseCheckpoint(rawCheckpoints[checkpoint], checkpoint),
    ]),
  );

  return {
    standards: {
      required: true,
      allow_waiver: false,
    },
    external: {
      policy: 'configured',
      independent_only: true,
      providers,
      checkpoints,
    },
  };
}

export function validationCheckpointForPhase(phaseId) {
  return Object.entries(VALIDATION_CHECKPOINTS)
    .find(([, configuredPhase]) => configuredPhase === phaseId)?.[0] ?? null;
}

export function effectiveValidationConfig(configOrValidation, orchestrator = 'manual') {
  const validation = normaliseValidationConfig(
    configOrValidation?.validation ?? configOrValidation,
  );
  const canonicalOrchestrator = canonicalValidationProvider(orchestrator);
  const normalisedOrchestrator = VALIDATION_PROVIDERS.includes(canonicalOrchestrator)
    ? canonicalOrchestrator
    : 'manual';

  const globallyEligible = VALIDATION_PROVIDERS.filter((provider) => {
    const setting = validation.external.providers[provider];
    return setting.state === 'available' && setting.enabled;
  });

  const checkpoints = Object.fromEntries(
    Object.entries(validation.external.checkpoints).map(([checkpoint, setting]) => {
      const requested = setting.validators === 'auto'
        ? globallyEligible
        : setting.validators.filter((provider) => globallyEligible.includes(provider));
      const providers = requested.filter((provider) => provider !== normalisedOrchestrator);

      return [
        checkpoint,
        {
          phase: VALIDATION_CHECKPOINTS[checkpoint],
          enabled: setting.enabled,
          max_cycles: setting.max_cycles,
          validators: providers,
          review: clone(setting.review),
          skipped_orchestrator: requested.includes(normalisedOrchestrator)
            ? normalisedOrchestrator
            : null,
        },
      ];
    }),
  );

  return {
    standards: clone(validation.standards),
    orchestrator: normalisedOrchestrator,
    providers: clone(validation.external.providers),
    checkpoints,
  };
}

export function setValidationProvider(config, provider, state, enabled = undefined) {
  requireEnum(provider, VALIDATION_PROVIDERS, 'validation provider');
  requireEnum(state, ['available', 'unavailable'], 'validation provider state');
  const validation = normaliseValidationConfig(config.validation);
  validation.external.providers[provider] = {
    state,
    enabled: state === 'available' ? (enabled ?? true) : false,
  };
  config.validation = validation;
  return config;
}

export function setValidationCheckpoint(config, checkpoint, update) {
  requireEnum(checkpoint, Object.keys(VALIDATION_CHECKPOINTS), 'validation checkpoint');
  const validation = normaliseValidationConfig(config.validation);
  validation.external.checkpoints[checkpoint] = normaliseCheckpoint(
    {
      ...validation.external.checkpoints[checkpoint],
      ...update,
      review: {
        ...validation.external.checkpoints[checkpoint].review,
        ...(update.review ?? {}),
      },
    },
    checkpoint,
  );
  config.validation = validation;
  return config;
}
