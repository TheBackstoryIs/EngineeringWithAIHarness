import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import {
  DEFAULT_DESIGN_SYSTEM_ID,
  designSystemStatus,
  listDesignSystems,
  resolveDesignSystem,
} from './design-systems.mjs';
import { projectPaths } from './paths.mjs';
import { loadProjectConfig } from './project.mjs';
import { prepareContextPack } from './runtime/context-assembly.mjs';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

function clean(value) {
  return String(value ?? '').trim();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function within(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function safeEvidenceDirectory(deliveryRoot, segments, options = {}) {
  const root = resolve(deliveryRoot);
  const realRoot = realpathSync(root);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (existsSync(current)) {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink()) throw new Error(`Design-system evidence directory may not be a symbolic link: ${segment}`);
      if (!metadata.isDirectory()) throw new Error(`Design-system evidence path must be a directory: ${segment}`);
    } else if (options.create) mkdirSync(current, { recursive: false, mode: 0o700 });
    else throw new Error(`Design-system evidence directory does not exist: ${segment}`);
    if (!within(realRoot, realpathSync(current))) throw new Error(`Design-system evidence directory may not escape its delivery: ${segment}`);
  }
  return current;
}

function deliveryWorkspace(projectRoot, slug) {
  const value = clean(slug);
  if (!slugPattern.test(value)) throw new Error('Design-system application requires a lower kebab-case delivery slug');
  const project = projectPaths(projectRoot);
  const root = resolve(project.buildRoot, value);
  const statePath = resolve(root, 'delivery-state.json');
  if (!existsSync(statePath)) throw new Error(`Design-system application requires an existing delivery: ${value}`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (state.schema !== 'ewai.delivery-state/v1' || state.slug !== value) throw new Error(`Invalid delivery state for design-system application: ${value}`);
  const ui = (state.adjuncts ?? []).find(({ id }) => id === 'ui-design');
  if (!ui || ui.status === 'skipped') throw new Error('Design-system application is available only for a UI-bearing delivery');
  return { project, root, state };
}

function resolvedSelection(projectRoot, options = {}) {
  const status = designSystemStatus(projectRoot, options);
  if (status.status !== 'ready') throw new Error(`Project design system is ${status.status}; re-resolve and select it before application`);
  const { config } = loadProjectConfig(projectRoot);
  const catalogue = listDesignSystems({ ...options, projectRoot });
  const resolved = resolveDesignSystem(config.design_system?.root?.id ?? DEFAULT_DESIGN_SYSTEM_ID, catalogue);
  return { status, resolved };
}

function focusSignals(focus) {
  return new Set(['ui-design', 'prototype', ...clean(focus).toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)]);
}

function contributionCandidate(record, focus) {
  const signals = focusSignals(focus);
  const relevant = [record.kind, record.title, ...record.applicability]
    .flatMap((value) => clean(value).toLowerCase().split(/[^a-z0-9-]+/))
    .some((value) => signals.has(value));
  const evidenceClass = record.required ? 'mandatory' : relevant ? 'relevant' : 'optional';
  const requiredMarkers = record.required ? [record.content.slice(0, 48).trim()].filter(Boolean) : [];
  return {
    id: record.qualifiedId.replaceAll('.', '-').replace(':', '--'),
    qualifiedId: record.qualifiedId,
    label: record.title,
    evidenceClass,
    priority: record.required ? 900 : relevant ? 100 : 10,
    sourcePath: `design-system/${record.packId}/${record.source}`,
    sourceDigest: record.contentDigest.replace(/^sha256:/, ''),
    content: record.content,
    requiredMarkers,
    freshness: 'current',
    selectionReason: record.required
      ? `${record.qualifiedId} is mandatory for this design-system application.`
      : relevant
        ? `${record.qualifiedId} matches the UI scope or current focus.`
        : `${record.qualifiedId} is optional background outside the current focus.`,
  };
}

function authorityCandidate() {
  return {
    id: 'design-system-authority', label: 'Design-system authority boundary', evidenceClass: 'mandatory', priority: 1_000,
    sourcePath: 'Docs/human-approval-and-assurance-guide.md',
    content: 'AUTHORITY_NONE Design-system application is advisory and cannot approve Build or Manual QA, certify accessibility, accept a deviation, publish, deploy, or release.',
    requiredMarkers: ['AUTHORITY_NONE', 'cannot approve Build or Manual QA', 'publish, deploy, or release'],
    selectionReason: 'Every application retains explicit human design, assurance, and release authority.',
  };
}

function safePersona(persona) {
  return {
    ref: persona.id,
    name: persona.name,
    tier: persona.tier,
    category: persona.category,
    matchedSignals: [...persona.matchedSignals],
    reason: persona.engagementReason,
  };
}

function receiptDigest(receipt) {
  const safe = structuredClone(receipt);
  delete safe.digest;
  return digest(canonical(safe));
}

function buildReceipt(slug, status, resolved, context, now) {
  const bySegment = new Map(context.segments.map((segment) => [segment.id, segment]));
  const contributions = resolved.contributions.map((record) => {
    const candidate = contributionCandidate(record, context.focus);
    const segment = bySegment.get(candidate.id);
    return {
      id: record.qualifiedId,
      kind: record.kind,
      contentDigest: record.contentDigest,
      disposition: segment?.disposition ?? 'deferred',
      reason: segment?.selectionReason ?? candidate.selectionReason,
      freshness: segment?.freshness ?? 'current',
    };
  });
  const receipt = {
    schema: 'ewai.design-system-receipt/v1',
    status: 'applied',
    delivery: slug,
    createdAt: now,
    designSystem: {
      mode: status.mode,
      approved: status.approved,
      root: { id: resolved.root.id, version: resolved.root.version, digest: resolved.root.digest, sourceClass: resolved.root.sourceClass },
      packs: resolved.packs.map((pack) => ({ id: pack.id, version: pack.version, digest: pack.digest, sourceClass: pack.sourceClass })),
      effectiveDigest: resolved.effectiveDigest,
      notice: status.notice,
    },
    context: {
      digest: context.digest,
      status: context.status,
      profile: context.profile,
      focus: context.focus,
      budget: { ...context.budget },
      selectedContributions: contributions.filter(({ disposition }) => ['selected', 'reused'].includes(disposition)),
      deferredContributions: contributions.filter(({ disposition }) => !['selected', 'reused'].includes(disposition)),
      overflow: context.reason === 'mandatory-overflow',
      recovery: [...context.recovery],
      sourceFreshness: 'current-at-application',
    },
    activePersonas: context.activePersonas.map(safePersona),
    authority: {
      level: 'none',
      notices: [
        'This receipt proves the context prepared for this delivery; it cannot approve Build or Manual QA.',
        'Visual quality, accessibility, intentional deviations, publication, deployment, and release require separate accountable evidence.',
      ],
    },
  };
  return { ...receipt, digest: receiptDigest(receipt) };
}

export function prepareDesignSystemApplication(projectRoot, slug, options = {}) {
  deliveryWorkspace(projectRoot, slug);
  const focus = clean(options.focus);
  if (focus.length > 2_000) throw new Error('Design-system application focus must be 2,000 characters or fewer');
  const { status, resolved } = resolvedSelection(projectRoot, options);
  const candidates = [authorityCandidate(), ...resolved.contributions.map((record) => contributionCandidate(record, focus))];
  const context = prepareContextPack({
    profile: 'design-system-apply',
    focus,
    budgetTokens: options.budgetTokens,
    repositoryRevision: options.repositoryRevision ?? resolved.effectiveDigest,
    deliveryRevision: options.deliveryRevision ?? 'workspace',
    candidates,
    personaCatalogue: options.personaCatalogue,
    personaLimit: options.personaLimit ?? 5,
    cacheRoot: resolve(projectPaths(projectRoot).runtimeRoot, 'runtime/context-packs/cache'),
  });
  const designSystem = { mode: status.mode, approved: status.approved, effectiveDigest: resolved.effectiveDigest, notice: status.notice };
  if (context.status !== 'ready') {
    return { status: context.status, reason: context.reason, designSystem, context, receipt: null, modelContext: null, recovery: [...context.recovery] };
  }
  const receipt = buildReceipt(slug, status, resolved, context, options.now ?? new Date().toISOString());
  return { status: 'ready', reason: context.reason, designSystem, context, receipt, modelContext: context.modelContext, recovery: [] };
}

function summary(receipt) {
  const selected = receipt.context.selectedContributions.map(({ id, reason }) => `- \`${id}\` — ${reason}`).join('\n') || '- None';
  const deferred = receipt.context.deferredContributions.map(({ id, reason }) => `- \`${id}\` — ${reason}`).join('\n') || '- None';
  const personas = receipt.activePersonas.map(({ ref, name, tier, reason }) => `- \`${ref}\` — ${name} (${tier}): ${reason}`).join('\n') || '- No contextual personas were engaged.';
  return `# Design-system application\n\n` +
    `**Delivery:** \`${receipt.delivery}\`\n` +
    `**Design-system root:** \`${receipt.designSystem.root.id}\`\n` +
    `**Mode:** ${receipt.designSystem.mode}${receipt.designSystem.approved ? ' (selected)' : ' (unapproved fallback)'}\n` +
    `**Effective digest:** \`${receipt.designSystem.effectiveDigest}\`\n` +
    `**Receipt digest:** \`${receipt.digest}\`\n\n` +
    `## Selected contributions\n\n${selected}\n\n## Deferred contributions\n\n${deferred}\n\n` +
    `## Active personas\n\n${personas}\n\n## Authority\n\n${receipt.authority.notices.map((notice) => `- ${notice}`).join('\n')}\n`;
}

export function writeDesignSystemReceipt(deliveryRoot, receipt) {
  if (receipt?.schema !== 'ewai.design-system-receipt/v1' || receiptDigest(receipt) !== receipt.digest) {
    throw new Error('Design-system receipt is invalid or its digest does not match');
  }
  const root = resolve(deliveryRoot);
  const folder = safeEvidenceDirectory(root, ['ui-design-assets', 'design-system'], { create: true });
  const suffix = receipt.digest.replace('sha256:', '');
  const receiptPath = `ui-design-assets/design-system/receipt-${suffix}.json`;
  const summaryPath = `ui-design-assets/design-system/summary-${suffix}.md`;
  const receiptContent = `${JSON.stringify(receipt, null, 2)}\n`;
  const summaryContent = summary(receipt);
  const writes = [[resolve(root, receiptPath), receiptContent], [resolve(root, summaryPath), summaryContent]];
  for (const [path, content] of writes) {
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== content) throw new Error(`Immutable design-system evidence already exists with different content: ${basename(path)}`);
    }
  }
  const created = [];
  try {
    for (const [path, content] of writes) {
      if (existsSync(path)) continue;
      writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      created.push(path);
    }
  } catch (error) {
    for (const path of created.reverse()) unlinkSync(path);
    throw error;
  }
  return { receiptPath, summaryPath, receiptDigest: receipt.digest, effectiveDigest: receipt.designSystem.effectiveDigest };
}

export function validateDesignSystemReceipt(deliveryRoot, receiptPath) {
  const root = resolve(deliveryRoot);
  const folder = safeEvidenceDirectory(root, ['ui-design-assets', 'design-system']);
  const candidate = resolve(root, clean(receiptPath));
  if (!clean(receiptPath) || isAbsolute(clean(receiptPath)) || !within(folder, candidate) || candidate === folder) {
    throw new Error('Design-system receipt path must identify a file inside ui-design-assets/design-system');
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) throw new Error(`Design-system receipt does not exist: ${receiptPath}`);
  if (lstatSync(candidate).isSymbolicLink()) throw new Error('Design-system receipt may not be a symbolic link');
  if (!within(realpathSync(folder), realpathSync(candidate))) throw new Error('Design-system receipt may not escape its folder');
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(candidate, 'utf8'));
  } catch (error) {
    throw new Error(`Design-system receipt is not valid JSON: ${error.message}`);
  }
  const errors = [];
  if (receipt.schema !== 'ewai.design-system-receipt/v1') errors.push('schema must be ewai.design-system-receipt/v1');
  if (receipt.status !== 'applied') errors.push('status must be applied');
  if (!slugPattern.test(clean(receipt.delivery))) errors.push('delivery must be lower kebab-case');
  if (!sha256Pattern.test(clean(receipt.digest))) errors.push('digest must be SHA-256');
  if (!sha256Pattern.test(clean(receipt.designSystem?.effectiveDigest))) errors.push('designSystem.effectiveDigest must be SHA-256');
  if (receipt.context?.status !== 'ready' || receipt.context?.overflow) errors.push('context must be ready without overflow');
  if (receipt.context?.sourceFreshness !== 'current-at-application') errors.push('source freshness is not recorded');
  if (receipt.authority?.level !== 'none') errors.push('authority level must be none');
  if (sha256Pattern.test(clean(receipt.digest)) && receiptDigest(receipt) !== receipt.digest) errors.push('receipt digest does not match its content');
  if (errors.length) throw new Error(`Design-system receipt is invalid:\n- ${errors.join('\n- ')}`);
  return receipt;
}

export function applyDesignSystem(projectRoot, slug, options = {}) {
  const prepared = prepareDesignSystemApplication(projectRoot, slug, options);
  if (prepared.status !== 'ready' || !prepared.receipt) return prepared;
  const { root } = deliveryWorkspace(projectRoot, slug);
  return { schema: 'ewai.design-system-application/v1', status: 'applied', ...writeDesignSystemReceipt(root, prepared.receipt), receipt: prepared.receipt };
}
