import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// This registry describes draft content, not gate evidence. A worker never
// chooses a checker, command, canonical approval path or destination root.
const definitions = {
  intent: { paths: ['intent-summary.md'], checks: ['intent-dependency-map-check'],
    humanQuestions: ['intent-evidence-review'] },
  reconcile: { paths: ['reconcile.md'], checks: ['intent-dependency-map-check'],
    humanQuestions: ['repository-truth-review', 'reconcile-disagreements'] },
  plan: { paths: ['build-plan.md', 'destination.md', 'gates/plan/discovery-notes.md'],
    checks: ['intent-dependency-map-check', 'task-graph-check'], humanQuestions: ['plan-contract-review'] },
  'pattern-validation': { paths: ['pattern-validation.md'],
    checks: ['intent-dependency-map-check', 'task-graph-check'], humanQuestions: ['repository-pattern-review'] },
  'test-plan': { paths: ['test-plan.md', 'gates/test-plan/task-to-test-traceability.md', 'gates/test-plan/red-green-refactor-traceability.md'],
    checks: ['task-graph-check'], humanQuestions: ['test-oracle-review'] },
};
const maxBytes = 128 * 1024;
const maxArtifactBytes = 32 * 1024;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const ownKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const safeFailure = code => ({ schema: 'ewai.autonomy-proposal-validation/v1', status: 'rejected', code, requiresHuman: true });
const immutable = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
};
export const autonomyWorkerSchema = immutable(JSON.parse(readFileSync(new URL('../config/autonomy-worker.schema.json', import.meta.url), 'utf8')));

export function getAutonomyPhaseContract(phase) {
  if (typeof phase !== 'string' || !Object.hasOwn(definitions, phase)) {
    return { status: 'unavailable', code: 'phase-contract-unavailable', requiresHuman: true };
  }
  return { schema: 'ewai.autonomy-phase-definition/v1', status: 'available', phase,
    ...structuredClone(definitions[phase]), maxBytes, maxArtifactBytes, maxArtifacts: 8,
    authority: 'draft-only' };
}

// Validate the wire bytes, not a provider-declared status or success summary.
// Parsing errors deliberately do not quote input. Validated content remains
// private to the host; the returned safe result contains references only.
export function validatePhaseProposal(contract, result) {
  const definition = getAutonomyPhaseContract(contract?.phase);
  if (definition.status !== 'available' || !digestPattern.test(contract?.digest ?? '')
    || !Array.isArray(contract?.sources) || !contract.sources.length
    || contract.sources.some(source => !/^[a-z][a-z0-9_.-]{0,79}$/.test(source?.id ?? '')
      || !digestPattern.test(source?.digest ?? ''))
    || new Set(contract.sources.map(source => source.id)).size !== contract.sources.length) return safeFailure('proposal-contract-invalid');
  if (!result || result.status !== 'complete' || result.exitCode !== 0 || result.executionStopped !== true) {
    return safeFailure(['truncated', 'timed-out', 'unavailable', 'cancelled', 'failed'].includes(result?.status)
      ? `proposal-${result.status}` : 'proposal-incomplete');
  }
  if (typeof result.output !== 'string') return safeFailure('proposal-malformed');
  if (Buffer.byteLength(result.output, 'utf8') > maxBytes) return safeFailure('proposal-too-large');
  let proposal;
  try { proposal = JSON.parse(result.output); } catch { return safeFailure('proposal-malformed'); }
  if (!ownKeys(proposal, ['schema', 'contractDigest', 'phase', 'artifacts'])
    || proposal.schema !== 'ewai.autonomy-phase-proposal/v1'
    || proposal.contractDigest !== contract.digest || proposal.phase !== contract.phase
    || !Array.isArray(proposal.artifacts) || proposal.artifacts.length < 1 || proposal.artifacts.length > 8) return safeFailure('proposal-schema-invalid');
  const sources = new Set(contract.sources.map(source => source.id)), seen = new Set(), artifacts = [];
  for (const artifact of proposal.artifacts) {
    if (!ownKeys(artifact, ['path', 'content', 'sourceRefs'])) return safeFailure('proposal-schema-invalid');
    if (!definition.paths.includes(artifact.path) || seen.has(artifact.path)) return safeFailure('proposal-destination-invalid');
    seen.add(artifact.path);
    if (typeof artifact.content !== 'string' || !artifact.content.trim()
      || Buffer.byteLength(artifact.content, 'utf8') > maxArtifactBytes
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(artifact.content)) return safeFailure('proposal-content-invalid');
    if (!Array.isArray(artifact.sourceRefs) || artifact.sourceRefs.length < 1 || artifact.sourceRefs.length > 32
      || new Set(artifact.sourceRefs).size !== artifact.sourceRefs.length
      || artifact.sourceRefs.some(ref => typeof ref !== 'string' || !sources.has(ref))) return safeFailure('proposal-source-invalid');
    // This is defence in depth for obvious forged verdicts, not a semantic
    // truth detector. Nothing in a draft is ever consumed as gate authority.
    if (artifact.content.split('\n').some(line => {
      const words = line.trim().toLowerCase().split(/[\s:=|*#-]+/).filter(Boolean);
      if (words[0] === 'manual' && words[1] === 'qa') words.splice(0, 2, 'manual-qa');
      if (!['gate', 'checker', 'verdict', 'approval', 'manual-qa'].includes(words[0])) return false;
      return ['pass', 'passed', 'approved', 'complete', 'completed'].includes(words.slice(1).find(word => !['is', 'status'].includes(word)));
    })
      || /\b(?:approve-build|approve-manual-qa|record-phase-gate|recordPhaseGate|recordBuildApproval)\b/.test(artifact.content)) return safeFailure('proposal-authority-forbidden');
    if (/```\s*(?:bash|sh|zsh|shell|powershell|cmd)\b|\$\(/.test(artifact.content)) return safeFailure('proposal-command-forbidden');
    artifacts.push({ path: artifact.path, bytes: Buffer.byteLength(artifact.content, 'utf8'),
      digest: `sha256:${createHash('sha256').update(artifact.content).digest('hex')}`, sourceRefs: [...artifact.sourceRefs] });
  }
  return { schema: 'ewai.autonomy-proposal-validation/v1', status: 'valid-draft', code: 'proposal-valid-draft',
    phase: contract.phase, contractDigest: contract.digest, artifacts,
    requiresHuman: true, authority: 'none', humanQuestions: definition.humanQuestions };
}
