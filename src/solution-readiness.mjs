import { createHash } from 'node:crypto';
import {
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
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deliveryPaths, sha256 } from './delivery-documents.mjs';
import { projectPaths } from './paths.mjs';
import { listPersonas, personalPersonaRoot, projectPersonaRoot } from './personas.mjs';
import { premiumPersonaRoot } from './checkin.mjs';
import { ASSURANCE_NOTICE } from './security-validation-config.mjs';
import { assessSecurityReadiness } from './runtime/security-validation.mjs';
import { readImpactWorkspace } from './runtime/impact-analysis.mjs';
import { selectContextualPersonas } from './runtime/persona-engagement.mjs';
import { readPersonaTestScenarioWorkspace } from './test-scenarios.mjs';
import { POLICY_DESIGN_AUTHORITY_NOTICE } from './policy-gate-integration.mjs';

export const READINESS_AUTHORITY_NOTICE = 'Solution Readiness Review is advisory evidence, not certification, business acceptance, Manual QA approval, security approval, deployment permission or release authorisation. Accountable humans retain every approval and risk decision.';

const BRIEF_SCHEMA = 'ewai.solution-readiness-brief/v1';
const REVIEW_INPUT_SCHEMA = 'ewai.solution-readiness-review-input/v1';
const REPORT_SCHEMA = 'ewai.solution-readiness-report/v1';
const ASSESSMENT_PATTERN = /^[a-f0-9]{16}$/;
const STATES = new Set(['satisfied', 'conditional', 'blocking', 'missing', 'stale', 'not-applicable', 'not-configured']);
const DISPOSITIONS = new Set(['accepted', 'conditional', 'blocked', 'insufficient-evidence', 'not-applicable']);
const DIMENSIONS = Object.freeze([
  ['purpose-acceptance', 'Purpose and acceptance'],
  ['impact', 'Impact and affected journeys'],
  ['standards', 'Standards coverage'],
  ['tests', 'Automated and persona-driven tests'],
  ['manual-qa', 'Manual QA'],
  ['external-validation', 'Independent external validation'],
  ['security', 'Security validation'],
  ['technology-hosting', 'Technology and hosting'],
  ['deployment-operations', 'Deployment and operations'],
  ['documentation-training', 'Documentation and training'],
  ['governance-specialist-assurance', 'Governance and specialist assurance'],
].map(([id, name]) => Object.freeze({ id, name })));

const profiles = [
  {
    id: 'internal-only',
    name: 'Internal only',
    description: 'A bounded internal tool without sensitive or client material.',
    requiredDimensions: ['purpose-acceptance', 'standards', 'tests', 'manual-qa', 'deployment-operations'],
    requiredHumanRoles: ['Product Owner', 'Technical Owner'],
    signals: ['internal tool', 'acceptance', 'operations', 'testing'],
  },
  {
    id: 'internal-sensitive',
    name: 'Internal sensitive',
    description: 'An internal solution handling sensitive, personal or commercially restricted information.',
    requiredDimensions: ['purpose-acceptance', 'standards', 'tests', 'manual-qa', 'security', 'technology-hosting', 'deployment-operations', 'governance-specialist-assurance'],
    requiredHumanRoles: ['Product Owner', 'Technical Owner', 'Security or Privacy Owner'],
    signals: ['sensitive data', 'security', 'privacy', 'hosting', 'operations'],
  },
  {
    id: 'client-facing',
    name: 'Client facing',
    description: 'A solution used by clients or handling client workflows and material.',
    requiredDimensions: ['purpose-acceptance', 'impact', 'standards', 'tests', 'manual-qa', 'external-validation', 'security', 'technology-hosting', 'deployment-operations', 'documentation-training', 'governance-specialist-assurance'],
    requiredHumanRoles: ['Product Owner', 'Technical Owner', 'Security or Privacy Owner', 'Service Owner'],
    signals: ['client', 'user journey', 'impact', 'security', 'service operations', 'training'],
  },
  {
    id: 'public-service',
    name: 'Public service',
    description: 'A publicly accessible service with broader availability, misuse and accessibility consequences.',
    requiredDimensions: DIMENSIONS.map((item) => item.id),
    requiredHumanRoles: ['Product Owner', 'Technical Owner', 'Security or Privacy Owner', 'Service Owner', 'Accessibility or User Representative'],
    signals: ['public service', 'accessibility', 'misuse', 'security', 'operations', 'user impact'],
  },
  {
    id: 'critical-regulated',
    name: 'Critical or regulated',
    description: 'A high-consequence or regulated context requiring named specialist and independent assurance routes.',
    requiredDimensions: DIMENSIONS.map((item) => item.id),
    requiredHumanRoles: ['Product Owner', 'Technical Owner', 'Security or Privacy Owner', 'Service Owner', 'Legal or Regulatory Specialist', 'Independent Assurance Reviewer'],
    signals: ['critical', 'regulated', 'independent assurance', 'legal', 'security', 'residual risk', 'operations'],
  },
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

deepFreeze(profiles);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function digest(value) {
  return sha256(JSON.stringify(canonical(value)));
}

function clean(value, label, maximum = 2_000) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`Solution readiness requires ${label}.`);
  if (result.length > maximum) throw new Error(`Solution readiness ${label} is too long.`);
  return result;
}

function exactFields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unknown field(s): ${unknown.join(', ')}.`);
}

function relativePath(projectRoot, path) {
  return relative(resolve(projectRoot), resolve(path)).replaceAll('\\', '/');
}

function isWithin(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function assertNoSymlinkEscape(root, target, label) {
  const inputRoot = resolve(root);
  const inputTarget = resolve(target);
  if (!isWithin(inputRoot, inputTarget)) throw new Error(`${label} must remain inside the project.`);
  const safeRoot = existsSync(inputRoot) ? realpathSync(inputRoot) : inputRoot;
  const safeTarget = resolve(safeRoot, relative(inputRoot, inputTarget));
  if (!isWithin(safeRoot, safeTarget)) throw new Error(`${label} must remain inside the project.`);
  let cursor = safeRoot;
  const rel = relative(safeRoot, safeTarget);
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    cursor = resolve(cursor, part);
    if (!existsSync(cursor)) break;
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link.`);
    if (!isWithin(safeRoot, realpathSync(cursor))) throw new Error(`${label} escapes the project.`);
  }
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function fileCitation(projectRoot, sourceType, path, limitation = '') {
  const root = resolve(projectRoot);
  const absolute = resolve(root, path);
  assertNoSymlinkEscape(root, absolute, 'Evidence citation');
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) throw new Error(`Evidence citation does not exist: ${path}`);
  const projectRelative = relativePath(root, absolute);
  if (!projectRelative || projectRelative.startsWith('../') || isAbsolute(projectRelative)) throw new Error('Evidence citation must be project-relative.');
  const content = readFileSync(absolute);
  const recordedAt = statSync(absolute).mtime.toISOString();
  const citationDigest = sha256(content);
  return {
    id: `EVD-${createHash('sha256').update(`${sourceType}:${projectRelative}:${citationDigest}`).digest('hex').slice(0, 12)}`,
    sourceType: clean(sourceType, 'citation source type', 100),
    path: projectRelative,
    digest: citationDigest,
    recordedAt,
    limitation: String(limitation ?? '').trim().slice(0, 500),
  };
}

function normaliseCitation(projectRoot, value) {
  exactFields(value, ['id', 'sourceType', 'path', 'digest', 'recordedAt', 'limitation'], 'Evidence citation');
  const supplied = clean(value.path, 'citation path', 500);
  if (isAbsolute(supplied) || supplied.split(/[\\/]/).includes('..')) throw new Error('Evidence citation must use a safe project-relative path.');
  const citation = fileCitation(projectRoot, value.sourceType, supplied, value.limitation);
  return { ...citation, recordedAt: value.recordedAt ? new Date(value.recordedAt).toISOString() : citation.recordedAt };
}

function entry(projectRoot, id, value, required) {
  if (!value || typeof value !== 'object') throw new Error(`Evidence dimension ${id} must be an object.`);
  if (!STATES.has(value.state)) throw new Error(`Evidence dimension ${id} has unsupported state: ${value.state}`);
  const definition = DIMENSIONS.find((item) => item.id === id);
  return {
    id,
    name: definition.name,
    required,
    state: value.state,
    summary: clean(value.summary, `${id} summary`, 1_000),
    citations: (value.citations ?? []).map((citation) => normaliseCitation(projectRoot, citation)),
    limitations: [...new Set((value.limitations ?? []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 20),
    nextActions: [...new Set((value.nextActions ?? []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 20),
  };
}

function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: null, maxBuffer: 20 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

function ignoredRevisionPath(path) {
  const normalised = path.replaceAll('\\', '/');
  return normalised.startsWith('SPECS/3.Evidence/readiness/') || normalised.startsWith('.ewai-pipeline/') || normalised.startsWith('.playwright-mcp/');
}

export function resolveReadinessRevision(projectRoot) {
  const root = resolve(projectRoot);
  const head = runGit(root, ['rev-parse', 'HEAD']);
  if (!head) return `project-files:${digest({ pipeline: existsSync(projectPaths(root).configPath) ? sha256(readFileSync(projectPaths(root).configPath)) : '' })}`;
  const headText = head.toString('utf8').trim();
  const diff = runGit(root, ['diff', '--binary', 'HEAD', '--', '.', ':(exclude)SPECS/3.Evidence/readiness/**']);
  const untrackedRaw = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const untracked = untrackedRaw ? untrackedRaw.toString('utf8').split('\0').filter(Boolean).filter((path) => !ignoredRevisionPath(path)).sort() : [];
  const hash = createHash('sha256');
  if (diff?.length) hash.update(diff);
  for (const path of untracked) {
    const absolute = resolve(root, path);
    if (!isWithin(root, absolute) || !existsSync(absolute) || !lstatSync(absolute).isFile()) continue;
    hash.update(`\0${path}\0`);
    hash.update(readFileSync(absolute));
  }
  if (!diff?.length && !untracked.length) return headText;
  return `${headText}:worktree-sha256:${hash.digest('hex')}`;
}

function walk(root, predicate, limit = 500) {
  if (!existsSync(root)) return [];
  const found = [];
  const pending = [root];
  while (pending.length && found.length < limit) {
    const current = pending.shift();
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, item.name);
      if (item.isDirectory() && !item.isSymbolicLink()) pending.push(path);
      else if (item.isFile() && predicate(path, item.name)) found.push(path);
      if (found.length >= limit) break;
    }
  }
  return found;
}

function evidenceValue(projectRoot, state, summary, paths = [], limitation = '', extras = {}) {
  return {
    state,
    summary,
    citations: paths.filter((path) => existsSync(resolve(projectRoot, path))).map((path) => fileCitation(projectRoot, extras.sourceType ?? 'project-evidence', path, limitation)),
    limitations: extras.limitations ?? (limitation ? [limitation] : []),
    nextActions: extras.nextActions ?? [],
  };
}

function phase(state, id) {
  return (state.phases ?? []).find((item) => item.id === id);
}

function firstIntentPath(projectRoot, specsRoot, slug) {
  return walk(resolve(specsRoot, '2.Purpose/intents'), (_path, name) => name === `${slug}.md`, 20)
    .map((path) => relativePath(projectRoot, path))[0] ?? '';
}

function latestTechnologyProfile(projectRoot, specsRoot) {
  return walk(resolve(specsRoot, '3.Evidence/archaeology'), (_path, name) => name === 'technology-hosting-profile.json', 100)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    .map((path) => relativePath(projectRoot, path))[0] ?? '';
}

function collectProjectEvidence(projectRoot, slug, personaCatalogue) {
  const root = resolve(projectRoot);
  const paths = deliveryPaths(root, slug);
  if (!existsSync(paths.statePath)) throw new Error(`Missing delivery truth for ${slug}.`);
  const state = readJson(paths.statePath, 'Delivery state');
  const specs = projectPaths(root).specsRoot;
  const deliveryRelative = relativePath(root, paths.statePath);
  const intentPath = firstIntentPath(root, specs, slug);
  const planStandard = resolve(paths.gatesRoot, 'standards-sweep/gate-ledger.json');
  const testGate = resolve(paths.gatesRoot, 'test-execute/gate-ledger.json');
  const manualGate = (state.humanGates ?? []).find((item) => item.id === 'manual-qa');
  const external = ['validate-external-plan', 'validate-external-test-plan', 'validate-external-code'].map((id) => phase(state, id)).filter(Boolean);
  let impact = null;
  try { impact = readImpactWorkspace(root, slug); } catch { impact = null; }
  let scenarios = null;
  try { scenarios = readPersonaTestScenarioWorkspace(root, slug, { personaCatalogue }); } catch { scenarios = null; }
  let security = null;
  try { security = assessSecurityReadiness(root); } catch (error) { security = { status: 'blocked', ready: false, reasons: [{ message: error.message }] }; }
  const hostingPath = latestTechnologyProfile(root, specs);
  const checklistPath = relativePath(root, resolve(paths.deliveryRoot, 'delivery-checklist.md'));
  const qaPath = relativePath(root, resolve(paths.deliveryRoot, 'qa-walkthrough.md'));
  const scenarioPath = relativePath(root, resolve(paths.deliveryRoot, 'test-scenarios.json'));
  const impactPath = impact?.assessments?.[0]?.jsonPath ?? '';
  const pipelinePath = relativePath(root, projectPaths(root).configPath);

  return {
    'purpose-acceptance': intentPath
      ? evidenceValue(root, 'satisfied', 'The accepted intent and delivery truth are present.', [intentPath, deliveryRelative], 'Intent acceptance does not prove implementation or release readiness.', { sourceType: 'intent-and-delivery' })
      : evidenceValue(root, 'missing', 'No accepted intent document was found for this delivery.', [deliveryRelative], 'Delivery state alone does not establish intended outcomes.', { nextActions: ['Restore or reconcile the accepted intent.'] }),
    impact: impact?.assessments?.length
      ? evidenceValue(root, impact.index?.fresh === false ? 'stale' : 'satisfied', 'A reviewed Impact assessment is available.', [impactPath], 'Impact consequences remain advisory and may require affected-user validation.', { sourceType: 'impact-assessment' })
      : evidenceValue(root, 'not-configured', 'No reviewed Impact assessment is available.', [], 'Absence of Impact evidence does not mean there is no impact.', { nextActions: [`Prepare Impact analysis for ${slug}.`] }),
    standards: existsSync(planStandard) && phase(state, 'standards-sweep')?.status === 'completed'
      ? evidenceValue(root, 'satisfied', 'The mandatory standards sweep completed with a recorded gate.', [relativePath(root, planStandard)], 'Standards coverage proves checked scope, not business acceptance.', { sourceType: 'standards-sweep' })
      : evidenceValue(root, 'missing', 'The mandatory standards sweep is not complete.', [], 'Incomplete standards evidence cannot be treated as passing.', { nextActions: ['Complete the EWAI Standards Sweep.'] }),
    tests: existsSync(testGate) && phase(state, 'test-execute')?.status === 'completed'
      ? evidenceValue(root, scenarios?.status === 'stale' ? 'stale' : 'satisfied', 'Automated test execution is complete and persona scenarios are included when reviewed.', [relativePath(root, testGate), ...(existsSync(resolve(root, scenarioPath)) ? [scenarioPath] : [])], 'Automated tests cannot replace representative-user or specialist evidence.', { sourceType: 'test-evidence' })
      : evidenceValue(root, 'missing', 'Automated test execution is not complete.', scenarios?.status === 'missing' ? [] : [scenarioPath], 'Planned or candidate scenarios are not executed proof.', { nextActions: ['Complete Test Execute and retain results.'] }),
    'manual-qa': manualGate?.status === 'approved' && manualGate.evidencePath
      ? evidenceValue(root, 'satisfied', 'Named Manual QA approval is recorded.', [manualGate.evidencePath], 'Manual QA applies only to its recorded scope and revision.', { sourceType: 'manual-qa' })
      : evidenceValue(root, 'missing', 'Named Manual QA approval is pending.', [], 'Automated checks cannot approve Manual QA.', { nextActions: ['Complete the named Manual QA walkthrough.'] }),
    'external-validation': external.length && external.every((item) => item.status === 'completed')
      ? evidenceValue(root, 'satisfied', 'Configured independent validation checkpoints completed.', external.map((item) => item.gatePath).filter(Boolean), 'External AI review is advisory and can miss issues.', { sourceType: 'external-validation' })
      : evidenceValue(root, external.some((item) => item.status === 'not-supported') ? 'not-configured' : 'missing', 'Independent external validation is unavailable or incomplete.', [], 'The orchestrating AI is not an independent reviewer.', { nextActions: ['Arrange proportionate independent or specialist review where required.'] }),
    security: security?.status === 'ready'
      ? evidenceValue(root, 'satisfied', 'Configured security readiness currently passes.', [pipelinePath], ASSURANCE_NOTICE, { sourceType: 'security-readiness' })
      : security?.status === 'not-configured'
        ? evidenceValue(root, 'not-configured', 'Security validation is not configured.', [pipelinePath], ASSURANCE_NOTICE, { nextActions: ['Configure proportionate security validation or record a specialist route.'] })
        : evidenceValue(root, 'blocking', 'Security readiness reports blocking, incomplete or stale evidence.', [pipelinePath], ASSURANCE_NOTICE, { nextActions: (security?.reasons ?? []).map((item) => item.message ?? item.code).filter(Boolean) }),
    'technology-hosting': hostingPath
      ? evidenceValue(root, 'satisfied', 'A reviewed technology and hosting profile is available.', [hostingPath], 'Repository configuration and owner statements still require current operational confirmation.', { sourceType: 'technology-hosting-profile' })
      : evidenceValue(root, 'not-configured', 'No reviewed technology and hosting profile is available.', [], 'Repository configuration alone does not prove current runtime hosting.', { nextActions: ['Run Archaeology technology and hosting discovery.'] }),
    'deployment-operations': phase(state, 'delivery')?.status === 'completed' && existsSync(resolve(root, checklistPath))
      ? evidenceValue(root, 'satisfied', 'Delivery evidence records deployment and operational handoff.', [checklistPath], 'A delivery checklist is not live-service telemetry.', { sourceType: 'delivery-operations' })
      : evidenceValue(root, 'missing', 'Delivery and operational handoff evidence is incomplete.', existsSync(resolve(root, checklistPath)) ? [checklistPath] : [], 'Implementation completion does not prove operational readiness.', { nextActions: ['Complete operational ownership, deployment and recovery evidence.'] }),
    'documentation-training': existsSync(resolve(root, qaPath)) || existsSync(resolve(root, checklistPath))
      ? evidenceValue(root, 'conditional', 'Some delivery or QA guidance exists and needs human scope review.', [qaPath, checklistPath], 'Existence does not prove that affected users have usable current guidance.', { sourceType: 'documentation-training', nextActions: ['Confirm affected-user documentation and training needs.'] })
      : evidenceValue(root, 'missing', 'No delivery-specific documentation or training evidence was found.', [], 'Technical tests do not prove user guidance is adequate.', { nextActions: ['Document user, operator and support changes.'] }),
    'governance-specialist-assurance': state.approvals?.build?.decision === 'approved'
      ? evidenceValue(root, 'conditional', 'Build approval exists; additional specialist routes depend on the selected profile.', [deliveryRelative], 'Build approval is not business acceptance, specialist assurance or release permission.', { sourceType: 'governance' })
      : evidenceValue(root, 'missing', 'No durable Build approval or specialist assurance route is recorded.', [deliveryRelative], 'Automated analysis cannot create governance authority.', { nextActions: ['Record the accountable human and specialist routes required by the profile.'] }),
  };
}

function installedPersonas(projectRoot) {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return listPersonas([
    resolve(sourceRoot, 'packs/personas/core/personas'),
    personalPersonaRoot(),
    premiumPersonaRoot(),
    projectPersonaRoot(projectRoot),
  ]);
}

function personaAvailability(catalogue) {
  return Object.fromEntries(['core', 'project', 'premium', 'personal'].map((tier) => {
    const count = catalogue.filter((item) => item.tier === tier).length;
    return [tier, { installed: count > 0, count, reason: count ? `${count} installed ${tier} persona${count === 1 ? '' : 's'} available.` : `No installed ${tier} personas were found.` }];
  }));
}

function readinessRoot(projectRoot) {
  return resolve(projectPaths(projectRoot).specsRoot, '3.Evidence/readiness');
}

function assessmentPaths(projectRoot, slug, assessmentId) {
  if (!ASSESSMENT_PATTERN.test(assessmentId)) throw new Error(`Invalid solution readiness assessment ID: ${assessmentId}`);
  const root = readinessRoot(projectRoot);
  const directory = resolve(root, slug, assessmentId);
  assertNoSymlinkEscape(root, directory, 'Readiness assessment');
  return {
    directory,
    briefJson: resolve(directory, 'readiness-brief.json'),
    briefMarkdown: resolve(directory, 'readiness-brief.md'),
    reviewTemplate: resolve(directory, 'readiness-review.template.json'),
    reportJson: resolve(directory, 'readiness-report.json'),
    reportMarkdown: resolve(directory, 'readiness-report.md'),
  };
}

function findAssessment(projectRoot, assessmentId) {
  if (!ASSESSMENT_PATTERN.test(assessmentId)) throw new Error(`Invalid solution readiness assessment ID: ${assessmentId}`);
  const matches = walk(readinessRoot(projectRoot), (path, name) => name === 'readiness-brief.json' && dirname(path).endsWith(`/${assessmentId}`), 5);
  if (!matches.length) throw new Error(`Unknown solution readiness assessment: ${assessmentId}`);
  if (matches.length > 1) throw new Error(`Ambiguous solution readiness assessment: ${assessmentId}`);
  const directory = dirname(matches[0]);
  const slug = relative(readinessRoot(projectRoot), dirname(directory)).replaceAll('\\', '/');
  return { slug, ...assessmentPaths(projectRoot, slug, assessmentId) };
}

function markdownBrief(brief) {
  const dimensions = brief.dimensions.map((item) => `| ${item.name} | ${item.required ? 'required' : 'optional'} | ${item.state} | ${item.summary.replaceAll('|', '\\|')} |`).join('\n');
  const personas = brief.activePersonas.length ? brief.activePersonas.map((item) => `- **${item.name}** (${item.tier}) — ${item.engagementReason}`).join('\n') : '- No matching installed persona was engaged; standard model reasoning remains available.';
  const sources = brief.dimensions.flatMap((item) => item.citations.map((citation) => `- \`${citation.id}\` ${citation.sourceType}: \`${citation.path}\` (${citation.digest.slice(0, 12)})`));
  return `# Solution Readiness Brief — ${brief.slug}\n\n**Assessment:** \`${brief.assessmentId}\`  \n**Profile:** ${brief.profile.name} (\`${brief.profile.id}\`)  \n**Repository revision:** \`${brief.repositoryRevision}\`  \n**Prepared:** ${brief.preparedAt}\n\n## Evidence dimensions\n\n| Dimension | Requirement | State | Summary |\n|---|---|---|---|\n${dimensions}\n\n## Active personas\n\n${personas}\n\nPersonas are advisory lenses. They do not supply evidence or approval.\n\n## Evidence citations\n\n${sources.join('\n') || '- No citations are available.'}\n\n## Notices\n\n${brief.notices.map((notice) => `> ${notice}`).join('\n\n')}\n`;
}

function markdownReport(report) {
  const rows = report.dimensions.map((item) => `| ${item.id} | ${item.disposition} | ${item.reason.replaceAll('|', '\\|')} |`).join('\n');
  return `# Solution Readiness Report — ${report.slug}\n\n**Assessment:** \`${report.assessmentId}\`  \n**Profile:** ${report.profile.name} (\`${report.profile.id}\`)  \n**Result:** \`${report.result}\`  \n**Reviewed by:** ${report.reviewedBy}  \n**Reviewed:** ${report.reviewedAt}\n\n## Reviewed dimensions\n\n| Dimension | Disposition | Reason |\n|---|---|---|\n${rows}\n\n## Conditions\n\n${report.conditions.map((item) => `- ${item.text} — ${item.owner}, review by ${item.reviewBy}`).join('\n') || '- None.'}\n\n## Residual risks\n\n${report.residualRisks.map((item) => `- ${item.summary} — ${item.owner}, review by ${item.reviewBy}`).join('\n') || '- None recorded.'}\n\n## Notices\n\n${report.notices.map((notice) => `> ${notice}`).join('\n\n')}\n`;
}

function writePreparation(paths, brief, reviewTemplate) {
  if (existsSync(paths.directory)) {
    const existing = readJson(paths.briefJson, 'Existing readiness brief');
    if (existing.preparationFingerprint !== brief.preparationFingerprint) throw new Error(`Readiness assessment ${brief.assessmentId} already exists with different content.`);
    return existing;
  }
  const parent = dirname(paths.directory);
  mkdirSync(parent, { recursive: true });
  const staging = `${paths.directory}.staging-${process.pid}`;
  assertNoSymlinkEscape(parent, staging, 'Readiness staging directory');
  mkdirSync(staging);
  try {
    writeFileSync(resolve(staging, 'readiness-brief.json'), `${JSON.stringify(brief, null, 2)}\n`);
    writeFileSync(resolve(staging, 'readiness-brief.md'), markdownBrief(brief));
    writeFileSync(resolve(staging, 'readiness-review.template.json'), `${JSON.stringify(reviewTemplate, null, 2)}\n`);
    renameSync(staging, paths.directory);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return brief;
}

export function listSolutionReadinessProfiles() {
  return profiles;
}

export function prepareSolutionReadinessReview(projectRoot, slug, profileId, options = {}) {
  const root = resolve(projectRoot);
  const delivery = deliveryPaths(root, clean(slug, 'delivery slug', 100));
  if (!existsSync(delivery.statePath)) throw new Error(`Missing delivery truth for ${slug}.`);
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown solution readiness profile: ${profileId}`);
  const repositoryRevision = clean(options.revision ?? resolveReadinessRevision(root), 'repository revision', 1_000);
  const catalogue = Array.isArray(options.personaCatalogue) ? options.personaCatalogue : installedPersonas(root);
  const rawEvidence = options.evidence ?? collectProjectEvidence(root, slug, catalogue);
  const dimensions = DIMENSIONS.map(({ id }) => entry(root, id, rawEvidence[id] ?? { state: 'missing', summary: `No evidence projection was supplied for ${id}.`, citations: [] }, profile.requiredDimensions.includes(id)));
  const activePersonas = selectContextualPersonas({
    signals: [...profile.signals, ...dimensions.filter((item) => item.state !== 'satisfied').flatMap((item) => [item.id, item.summary])],
    context: { slug, profile: profile.id, dimensions: dimensions.map((item) => ({ id: item.id, state: item.state, required: item.required })) },
    personaCatalogue: catalogue,
    contextLabel: `${profile.name} solution readiness`,
    limit: 8,
  });
  const sourceDigest = digest(dimensions.map((item) => ({ id: item.id, state: item.state, citations: item.citations, summary: item.summary, limitations: item.limitations })));
  const availability = personaAvailability(catalogue);
  const preparationFingerprint = digest({ slug, profile, repositoryRevision, sourceDigest, activePersonas, availability });
  const assessmentId = preparationFingerprint.slice(0, 16);
  const preparedAt = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  const base = {
    schema: BRIEF_SCHEMA,
    assessmentId,
    slug,
    profile,
    repositoryRevision,
    sourceDigest,
    preparationFingerprint,
    preparedAt,
    dimensions,
    activePersonas,
    availability,
    notices: [ASSURANCE_NOTICE, READINESS_AUTHORITY_NOTICE, POLICY_DESIGN_AUTHORITY_NOTICE],
    guidance: { advisory: true, approvalsChanged: false, premiumSyncAttempted: false, sourceDomainsRemainAuthoritative: true },
  };
  const brief = { ...base, digest: digest(base) };
  const reviewTemplate = {
    schema: REVIEW_INPUT_SCHEMA,
    assessmentId,
    preparedDigest: brief.digest,
    dimensions: dimensions.filter((item) => item.required).map((item) => ({ id: item.id, disposition: item.state === 'satisfied' ? 'accepted' : 'insufficient-evidence', reason: '', sourceRefs: item.citations.map((citation) => citation.id), conditions: [], residualRisks: [] })),
    notes: '',
  };
  const paths = assessmentPaths(root, slug, assessmentId);
  const stored = writePreparation(paths, brief, reviewTemplate);
  const storedReviewTemplate = readJson(paths.reviewTemplate, 'Readiness review template');
  return {
    schema: 'ewai.solution-readiness-preparation/v1',
    status: 'prepared',
    assessmentId,
    brief: stored,
    reviewTemplate: storedReviewTemplate,
    paths: Object.fromEntries(Object.entries(paths).filter(([key]) => key !== 'directory').map(([key, path]) => [key, relativePath(root, path)])),
  };
}

function normaliseCondition(value, label, now) {
  exactFields(value, label === 'condition' ? ['text', 'owner', 'reviewBy'] : ['summary', 'owner', 'reviewBy'], label);
  const reviewBy = new Date(clean(value.reviewBy, `${label} reviewBy`, 100)).toISOString();
  if (new Date(reviewBy).getTime() <= new Date(now).getTime()) throw new Error(`${label} reviewBy must be in the future.`);
  return {
    [label === 'condition' ? 'text' : 'summary']: clean(value[label === 'condition' ? 'text' : 'summary'], `${label} description`, 1_000),
    owner: clean(value.owner, `${label} owner`, 200),
    reviewBy,
  };
}

function deriveResult(dimensions) {
  if (dimensions.some((item) => item.disposition === 'blocked' || item.preparedState === 'blocking')) return 'blocked';
  if (dimensions.some((item) => item.disposition === 'insufficient-evidence' || ['missing', 'stale', 'not-configured'].includes(item.preparedState))) return 'insufficient-evidence';
  if (dimensions.some((item) => item.disposition === 'conditional' || item.disposition === 'not-applicable' || item.preparedState === 'conditional')) return 'conditional';
  return 'ready-for-human-decision';
}

export function recordSolutionReadinessReview(projectRoot, assessmentId, input, options = {}) {
  const root = resolve(projectRoot);
  const paths = findAssessment(root, assessmentId);
  if (existsSync(paths.reportJson) || existsSync(paths.reportMarkdown)) throw new Error(`Solution readiness report ${assessmentId} already exists and is immutable.`);
  const brief = readJson(paths.briefJson, 'Readiness brief');
  exactFields(input, ['schema', 'assessmentId', 'preparedDigest', 'dimensions', 'notes'], 'Solution readiness review');
  if (input.schema !== REVIEW_INPUT_SCHEMA) throw new Error(`Solution readiness review schema must be ${REVIEW_INPUT_SCHEMA}.`);
  if (input.assessmentId !== assessmentId) throw new Error('Solution readiness review assessment ID does not match.');
  if (input.preparedDigest !== brief.digest) throw new Error('Solution readiness review prepared digest does not match.');
  const reviewedBy = clean(options.reviewedBy, 'reviewedBy', 200);
  const reviewedAt = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  if (!Array.isArray(input.dimensions)) throw new Error('Solution readiness review dimensions must be an array.');
  const supplied = new Map();
  for (const decision of input.dimensions) {
    exactFields(decision, ['id', 'disposition', 'reason', 'sourceRefs', 'conditions', 'residualRisks'], 'Readiness dimension decision');
    if (supplied.has(decision.id)) throw new Error(`Duplicate readiness dimension decision: ${decision.id}`);
    supplied.set(decision.id, decision);
  }
  const requiredIds = new Set(brief.dimensions.filter((item) => item.required).map((item) => item.id));
  const unexpectedIds = [...supplied.keys()].filter((id) => !requiredIds.has(id));
  if (unexpectedIds.length) throw new Error(`Solution readiness review contains unknown or non-required dimension(s): ${unexpectedIds.join(', ')}.`);
  const decisions = brief.dimensions.filter((item) => item.required).map((prepared) => {
    const decision = supplied.get(prepared.id);
    if (!decision) throw new Error(`Missing required readiness dimension decision: ${prepared.id}`);
    if (!DISPOSITIONS.has(decision.disposition)) throw new Error(`Unsupported readiness disposition for ${prepared.id}: ${decision.disposition}`);
    if (decision.disposition === 'accepted' && ['blocking', 'missing', 'stale', 'not-configured'].includes(prepared.state)) throw new Error(`${prepared.id} is ${prepared.state} and cannot be accepted without evidence.`);
    const sourceRefs = [...new Set((decision.sourceRefs ?? []).map((item) => clean(item, `${prepared.id} source reference`, 100)))];
    const dimensionRefs = new Set(prepared.citations.map((citation) => citation.id));
    const unrelatedRefs = sourceRefs.filter((item) => !dimensionRefs.has(item));
    if (unrelatedRefs.length) throw new Error(`${prepared.id} references unknown evidence for that dimension: ${unrelatedRefs.join(', ')}.`);
    const conditions = (decision.conditions ?? []).map((item) => normaliseCondition(item, 'condition', reviewedAt));
    const residualRisks = (decision.residualRisks ?? []).map((item) => normaliseCondition(item, 'residual risk', reviewedAt));
    if (decision.disposition === 'conditional' && !conditions.length) throw new Error(`${prepared.id} conditional disposition requires an owned condition.`);
    return {
      id: prepared.id,
      preparedState: prepared.state,
      disposition: decision.disposition,
      reason: clean(decision.reason, `${prepared.id} reason`, 2_000),
      sourceRefs,
      conditions,
      residualRisks,
    };
  });
  const base = {
    schema: REPORT_SCHEMA,
    assessmentId,
    slug: brief.slug,
    profile: brief.profile,
    repositoryRevision: brief.repositoryRevision,
    preparedDigest: brief.digest,
    reviewedBy,
    reviewedAt,
    result: deriveResult(decisions),
    dimensions: decisions,
    conditions: decisions.flatMap((item) => item.conditions.map((condition) => ({ dimensionId: item.id, ...condition }))),
    residualRisks: decisions.flatMap((item) => item.residualRisks.map((risk) => ({ dimensionId: item.id, ...risk }))),
    activePersonas: brief.activePersonas,
    notes: String(input.notes ?? '').trim().slice(0, 5_000),
    notices: [ASSURANCE_NOTICE, READINESS_AUTHORITY_NOTICE, POLICY_DESIGN_AUTHORITY_NOTICE],
    authority: { advisory: true, manualQaChanged: false, securityDispositionChanged: false, policyDecisionChanged: false, releaseChanged: false },
  };
  const report = { ...base, digest: digest(base) };
  const markdown = markdownReport(report);
  const stagingJson = `${paths.reportJson}.staging-${process.pid}`;
  const stagingMarkdown = `${paths.reportMarkdown}.staging-${process.pid}`;
  try {
    writeFileSync(stagingJson, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(stagingMarkdown, markdown);
    if (existsSync(paths.reportJson) || existsSync(paths.reportMarkdown)) throw new Error(`Solution readiness report ${assessmentId} already exists and is immutable.`);
    renameSync(stagingJson, paths.reportJson);
    renameSync(stagingMarkdown, paths.reportMarkdown);
  } finally {
    rmSync(stagingJson, { force: true });
    rmSync(stagingMarkdown, { force: true });
  }
  return { schema: 'ewai.solution-readiness-recording/v1', status: 'recorded', assessmentId, report, paths: { reportJson: relativePath(root, paths.reportJson), reportMarkdown: relativePath(root, paths.reportMarkdown) } };
}

export function readSolutionReadinessStatus(projectRoot, assessmentId, options = {}) {
  const root = resolve(projectRoot);
  const paths = findAssessment(root, assessmentId);
  const brief = readJson(paths.briefJson, 'Readiness brief');
  const report = existsSync(paths.reportJson) ? readJson(paths.reportJson, 'Readiness report') : null;
  const currentRevision = clean(options.revision ?? resolveReadinessRevision(root), 'repository revision', 1_000);
  const drift = [];
  const { digest: briefDigest, ...briefBody } = brief;
  if (digest(briefBody) !== briefDigest) drift.push({ kind: 'brief-digest', status: 'changed' });
  if (report) {
    const { digest: reportDigest, ...reportBody } = report;
    if (digest(reportBody) !== reportDigest) drift.push({ kind: 'report-digest', status: 'changed' });
    if (report.preparedDigest !== brief.digest) drift.push({ kind: 'report-binding', status: 'changed' });
  }
  if (currentRevision !== brief.repositoryRevision) drift.push({ kind: 'repository-revision', prepared: brief.repositoryRevision, current: currentRevision });
  const currentProfile = profiles.find((item) => item.id === brief.profile?.id);
  if (!currentProfile || digest(currentProfile) !== digest(brief.profile)) drift.push({ kind: 'profile', prepared: brief.profile?.id ?? '', current: currentProfile?.id ?? 'missing' });
  for (const citation of brief.dimensions.flatMap((item) => item.citations)) {
    const absolute = resolve(root, citation.path);
    try {
      assertNoSymlinkEscape(root, absolute, 'Evidence citation');
      if (!existsSync(absolute)) drift.push({ kind: 'cited-evidence', citationId: citation.id, path: citation.path, status: 'missing' });
      else if (sha256(readFileSync(absolute)) !== citation.digest) drift.push({ kind: 'cited-evidence', citationId: citation.id, path: citation.path, status: 'changed' });
    } catch {
      drift.push({ kind: 'cited-evidence', citationId: citation.id, path: citation.path, status: 'unsafe' });
    }
  }
  return {
    schema: 'ewai.solution-readiness-status/v1',
    assessmentId,
    slug: brief.slug,
    status: drift.length ? 'stale' : report ? 'current' : 'awaiting-human-review',
    preparedAt: brief.preparedAt,
    reviewedAt: report?.reviewedAt ?? null,
    result: report?.result ?? null,
    profile: brief.profile,
    repositoryRevision: brief.repositoryRevision,
    currentRevision,
    drift,
    activePersonas: brief.activePersonas,
    notices: [ASSURANCE_NOTICE, READINESS_AUTHORITY_NOTICE, POLICY_DESIGN_AUTHORITY_NOTICE],
    paths: { briefJson: relativePath(root, paths.briefJson), reportJson: existsSync(paths.reportJson) ? relativePath(root, paths.reportJson) : null },
  };
}
