import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, extname, isAbsolute, posix, relative, resolve } from 'node:path';
import { atomicJson, atomicText, deliveryPaths, isWithin, sha256 } from '../delivery-documents.mjs';
import {
  repositoryIndexFreshness,
  repositoryIndexStatus,
  repositorySourceMapCoverage,
  repositoryStandards
} from './repository-index.mjs';
import { openRuntimeDatabase } from './database.mjs';
import { selectContextualPersonas } from './persona-engagement.mjs';

const ASSESSMENT_SCHEMA = 'ewai.impact-assessment/v1';
const PREVIEW_SCHEMA = 'ewai.impact-preview/v1';
const MAX_SUMMARY = 2_000;
const MAX_TARGETS = 12;
const MAX_TARGET = 240;
const MAX_DEPTH = 2;
const MAX_NODES = 80;
const moduleExtensions = ['.mjs', '.js', '.ts', '.vue', '.php'];
const routeDecisions = new Set(['required', 'recommended', 'not-indicated']);
const policyDimensionKeys = Object.freeze(['actors', 'aiUse', 'data', 'destinations', 'hosting', 'integrations']);

function failure(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function policyDimensions(value) {
  if (value == null) return Object.fromEntries(policyDimensionKeys.map((key) => [key, []]));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('Policy-material Impact dimensions must be an object', 400);
  const unknown = Object.keys(value).filter((key) => !policyDimensionKeys.includes(key));
  if (unknown.length) throw failure(`Unsupported policy-material Impact dimension(s): ${unknown.join(', ')}`, 400);
  return Object.fromEntries(policyDimensionKeys.map((key) => {
    const supplied = value[key] ?? [];
    if (!Array.isArray(supplied) || supplied.length > 40) throw failure(`Policy-material Impact ${key} must be an array of at most 40 values`, 400);
    const values = unique(supplied.map((item) => cleanText(item)).filter(Boolean)).sort();
    if (values.some((item) => item.length > 160 || /[\u0000-\u001f\u007f]/.test(item))) throw failure(`Policy-material Impact ${key} contains an invalid value`, 400);
    return [key, values];
  }));
}

function policyRelevantDigest(value) {
  return `sha256:${sha256(JSON.stringify(value))}`;
}

function safeTarget(value) {
  const target = cleanText(value).replaceAll('\\', '/');
  if (!target || target.length > MAX_TARGET || target.includes('\0') || isAbsolute(target)) {
    throw failure('Impact targets must be bounded repository-relative paths or symbols', 400);
  }
  if (target.split('/').includes('..') || target.startsWith('./') || target.includes('://')) {
    throw failure('Impact targets must be repository-relative and may not traverse outside the project', 400);
  }
  return target;
}

function validateInput(input = {}) {
  const summary = cleanText(input.summary);
  if (!summary || summary.length > MAX_SUMMARY) throw failure(`Impact summary must contain 1-${MAX_SUMMARY} characters`, 400);
  if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > MAX_TARGETS) {
    throw failure(`Impact analysis requires 1-${MAX_TARGETS} repository-relative paths or symbols`, 400);
  }
  const dimensions = policyDimensions(input.policyDimensions);
  return { summary, targets: unique(input.targets.map(safeTarget)), policyDimensions: dimensions, policyRelevantDigest: policyRelevantDigest(dimensions) };
}

function currentIndex(projectRoot) {
  const status = repositoryIndexStatus(projectRoot);
  const freshness = repositoryIndexFreshness(projectRoot);
  const sourceMap = repositorySourceMapCoverage(projectRoot);
  if (status.status !== 'completed' || !status.run || freshness.stale) {
    const reason = freshness.reason ?? (freshness.summary ? JSON.stringify(freshness.summary) : status.status);
    throw failure(`Repository map is stale or unavailable (${reason}); refresh it before analysing impact`);
  }
  return {
    runId: Number(status.run.id),
    fresh: true,
    status: status.status,
    indexed: Number(status.counts.files ?? 0),
    parsed: Number(status.counts.parsed ?? 0),
    failed: Number(status.counts.failed ?? 0),
    freshness,
    sourceMap
  };
}

function splitStoredPath(stored) {
  const index = stored.indexOf(':');
  return index < 0 ? { repo: '', relative: stored } : { repo: stored.slice(0, index), relative: stored.slice(index + 1) };
}

function publicPath(stored) {
  return splitStoredPath(stored).relative;
}

function resolveImportedPath(importer, sourceModule, knownPaths) {
  if (!sourceModule.startsWith('.')) return '';
  const { repo, relative: importerRelative } = splitStoredPath(importer);
  const base = posix.normalize(posix.join(posix.dirname(importerRelative), sourceModule));
  const candidates = extname(base)
    ? [base]
    : [...moduleExtensions.map((extension) => `${base}${extension}`), ...moduleExtensions.map((extension) => `${base}/index${extension}`)];
  return candidates.map((candidate) => `${repo}:${candidate}`).find((candidate) => knownPaths.has(candidate)) ?? '';
}

function resolveTargets(files, symbols, targets) {
  const resolvedTargets = [];
  const unresolvedTargets = [];
  const ambiguousTargets = [];
  for (const input of targets) {
    const lower = input.toLowerCase();
    const exactFiles = files.filter((file) => file.path.toLowerCase() === lower || publicPath(file.path).toLowerCase() === lower);
    if (exactFiles.length === 1) {
      resolvedTargets.push({ input, kind: 'file', path: exactFiles[0].path, displayPath: publicPath(exactFiles[0].path), resolution: 'exact-path' });
      continue;
    }
    const exactSymbols = symbols.filter((symbol) => symbol.symbol_name.toLowerCase() === lower);
    if (exactSymbols.length === 1) {
      resolvedTargets.push({ input, kind: 'symbol', symbol: exactSymbols[0].symbol_name, path: exactSymbols[0].path, displayPath: publicPath(exactSymbols[0].path), line: exactSymbols[0].line, resolution: 'exact-symbol' });
      continue;
    }
    const suffixFiles = files.filter((file) => publicPath(file.path).toLowerCase().endsWith(lower));
    const partialSymbols = symbols.filter((symbol) => symbol.symbol_name.toLowerCase().includes(lower));
    const candidates = unique([...suffixFiles.map((file) => file.path), ...partialSymbols.map((symbol) => symbol.path)]);
    if (candidates.length === 1) {
      resolvedTargets.push({ input, kind: suffixFiles.length ? 'file' : 'symbol', path: candidates[0], displayPath: publicPath(candidates[0]), resolution: 'unique-match' });
    } else if (candidates.length > 1 || exactFiles.length > 1 || exactSymbols.length > 1) {
      ambiguousTargets.push({ input, candidates: unique([...exactFiles, ...suffixFiles].map((file) => publicPath(file.path)).concat(exactSymbols.concat(partialSymbols).map((symbol) => `${publicPath(symbol.path)}:${symbol.symbol_name}`))).slice(0, 12) });
    } else unresolvedTargets.push(input);
  }
  return { resolvedTargets, unresolvedTargets, ambiguousTargets };
}

function traverseGraph(files, imports, seeds, options = {}) {
  const maxDepth = Math.max(1, Math.min(MAX_DEPTH, Number(options.maxDepth ?? MAX_DEPTH)));
  const maxNodes = Math.max(1, Math.min(MAX_NODES, Number(options.maxNodes ?? MAX_NODES)));
  const knownPaths = new Set(files.map((file) => file.path));
  const outgoing = new Map();
  const incoming = new Map();
  for (const item of imports) {
    const target = resolveImportedPath(item.path, item.source_module, knownPaths);
    if (!target) continue;
    if (!outgoing.has(item.path)) outgoing.set(item.path, []);
    if (!incoming.has(target)) incoming.set(target, []);
    outgoing.get(item.path).push({ path: target, sourceModule: item.source_module, line: item.line });
    incoming.get(target).push({ path: item.path, sourceModule: item.source_module, line: item.line });
  }

  const nodes = new Map();
  const queue = [];
  for (const seed of unique(seeds)) {
    nodes.set(seed, { path: publicPath(seed), storedPath: seed, direction: 'seed', distance: 0, relation: 'selected target' });
    queue.push({ path: seed, distance: 0 });
  }
  let truncated = false;
  while (queue.length) {
    const current = queue.shift();
    if (current.distance >= maxDepth) continue;
    const neighbours = [
      ...(outgoing.get(current.path) ?? []).map((edge) => ({ ...edge, direction: 'downstream-dependency', relation: 'imports' })),
      ...(incoming.get(current.path) ?? []).map((edge) => ({ ...edge, direction: 'upstream-consumer', relation: 'imports' }))
    ];
    for (const neighbour of neighbours) {
      if (nodes.has(neighbour.path)) continue;
      if (nodes.size >= maxNodes) {
        truncated = true;
        continue;
      }
      const distance = current.distance + 1;
      nodes.set(neighbour.path, {
        path: publicPath(neighbour.path),
        storedPath: neighbour.path,
        direction: neighbour.direction,
        distance,
        relation: neighbour.relation,
        sourceModule: neighbour.sourceModule,
        line: neighbour.line ?? null
      });
      queue.push({ path: neighbour.path, distance });
    }
  }
  return {
    maxDepth,
    maxNodes,
    truncated,
    nodes: [...nodes.values()].map(({ storedPath, ...node }) => node)
      .sort((left, right) => left.distance - right.distance || left.path.localeCompare(right.path))
  };
}

const impactDefinitions = [
  { id: 'user-workflow', label: 'User workflow', patterns: ['user', 'customer', 'workflow', 'journey', 'form', 'screen', 'experience', 'delegated'], personaSignals: ['user workflow', 'acceptance', 'outcomes'] },
  { id: 'public-interface', label: 'Public interface', patterns: ['public', 'api', 'route', 'endpoint', 'interface', 'contract'], personaSignals: ['public interface', 'acceptance', 'integration'] },
  { id: 'data', label: 'Data', patterns: ['data', 'database', 'record', 'storage', 'schema', 'personal'], personaSignals: ['data', 'privacy', 'information governance'] },
  { id: 'security-privacy', label: 'Security and privacy', patterns: ['security', 'permission', 'access', 'authorisation', 'authorization', 'identity', 'privacy', 'authentication'], personaSignals: ['security', 'identity', 'permission', 'privacy'] },
  { id: 'operations', label: 'Operations', patterns: ['operation', 'runtime', 'recovery', 'failure', 'log', 'monitor', 'support', 'deploy'], personaSignals: ['operations', 'recovery', 'service behaviour'] },
  { id: 'maintainability', label: 'Maintainability', patterns: ['refactor', 'internal', 'helper', 'implementation', 'architecture', 'dependency'], personaSignals: ['maintainability', 'architecture', 'code review'] },
  { id: 'testing', label: 'Testing', patterns: ['test', 'spec', 'quality', 'regression'], personaSignals: ['testing', 'quality', 'regression'] },
  { id: 'documentation', label: 'Documentation and training', patterns: ['document', 'guidance', 'training', 'help', 'instruction', 'communication'], personaSignals: ['documentation', 'training', 'communication'] }
];

function classifyImpacts(summary, observed) {
  const haystack = `${summary} ${observed.nodes.map((node) => node.path).join(' ')}`.toLowerCase();
  const explicitlyInternal = /\binternal\b/.test(summary.toLowerCase()) && /without changing|no change to|unchanged/.test(summary.toLowerCase());
  return impactDefinitions.flatMap((definition) => {
    if (explicitlyInternal && ['user-workflow', 'public-interface', 'documentation'].includes(definition.id)) return [];
    const signals = definition.patterns.filter((pattern) => haystack.includes(pattern));
    if (!signals.length) return [];
    const evidencePaths = observed.nodes.filter((node) => definition.patterns.some((pattern) => node.path.toLowerCase().includes(pattern))).map((node) => node.path);
    return [{
      id: definition.id,
      label: definition.label,
      authority: 'inferred',
      signals,
      evidencePaths: unique(evidencePaths.length ? evidencePaths : observed.nodes.slice(0, 3).map((node) => node.path)),
      personaSignals: definition.personaSignals
    }];
  });
}

function reviewRoutes(impactAreas, observed) {
  const areas = new Set(impactAreas.map((area) => area.id));
  const productRequired = ['user-workflow', 'public-interface', 'documentation'].some((id) => areas.has(id));
  const securityRequired = areas.has('security-privacy') || areas.has('data');
  const operationsRecommended = areas.has('operations');
  const maintainerRequired = observed.truncated || observed.nodes.length > 20;
  return [
    { id: 'product-owner', label: 'Product Owner', recommendation: productRequired ? 'required' : 'not-indicated', reason: productRequired ? 'User workflow, public interface, documentation, training, acceptance, or material outcomes may change.' : 'No user-facing, acceptance, documentation, training, or outcome consequence was found in the bounded evidence.', authorityBoundary: 'Confirms product consequence and acceptance evidence; does not approve Build.' },
    { id: 'security-identity', label: 'Security or identity owner', recommendation: securityRequired ? 'required' : 'not-indicated', reason: securityRequired ? 'Security, identity, permission, privacy, or data signals are present.' : 'No security, identity, privacy, permission, or data signal was found.', authorityBoundary: 'Reviews the relevant security boundary; this assessment is not certification.' },
    { id: 'service-operator', label: 'Service operator', recommendation: operationsRecommended ? 'recommended' : 'not-indicated', reason: operationsRecommended ? 'Operational, recovery, support, logging, or runtime behaviour may change.' : 'No operational consequence was found in the bounded evidence.', authorityBoundary: 'Reviews operability and recovery; does not approve release.' },
    { id: 'maintainer', label: 'Maintainer', recommendation: maintainerRequired ? 'required' : 'recommended', reason: maintainerRequired ? 'The observed radius is broad or truncated and needs explicit maintainability review.' : 'A maintainer should verify dependency, test, and implementation consequences.', authorityBoundary: 'Reviews technical change quality; does not replace product or assurance review.' },
    { id: 'user-validation', label: 'User validation', recommendation: productRequired ? 'recommended' : 'not-indicated', reason: productRequired ? 'A user-visible consequence should be validated with representative people.' : 'No user-visible consequence was found in the bounded evidence.', authorityBoundary: 'Human user evidence takes priority over persona simulation.' }
  ];
}

function applicableStandards(projectRoot, slug, resolvedTargets, observed) {
  const targets = unique([slug, ...resolvedTargets.map((target) => target.displayPath), ...observed.nodes.map((node) => node.path)]);
  const standards = targets.flatMap((target) => repositoryStandards(projectRoot, target).standards);
  return [...new Map(standards.map((standard) => [`${standard.standardId}:${standard.sourcePath}:${standard.targetPath}`, standard])).values()]
    .map((standard) => ({ ...standard, authority: 'applicable-not-compliance' }));
}

export function previewImpactAssessment(projectRoot, slug, input = {}, options = {}) {
  const validated = validateInput(input);
  deliveryPaths(projectRoot, slug);
  const index = currentIndex(projectRoot);
  const database = openRuntimeDatabase(projectRoot);
  let files;
  let symbols;
  let imports;
  try {
    files = database.prepare('SELECT repo, path, language, parser_status FROM repo_files WHERE run_id = ? ORDER BY path').all(index.runId);
    symbols = database.prepare('SELECT symbol_kind, symbol_name, path, line, signature FROM repo_symbols WHERE run_id = ? ORDER BY path, line').all(index.runId);
    imports = database.prepare('SELECT path, source_module, imported_name, local_name, import_kind, line FROM repo_imports WHERE run_id = ? ORDER BY path, line').all(index.runId);
  } finally {
    database.close();
  }
  const resolution = resolveTargets(files, symbols, validated.targets);
  const observed = traverseGraph(files, imports, resolution.resolvedTargets.map((target) => target.path), options);
  const impactAreas = classifyImpacts(validated.summary, observed);
  const signals = unique(impactAreas.flatMap((area) => area.personaSignals));
  const activePersonas = selectContextualPersonas({
    contextLabel: 'the proposed change and its impact',
    signals,
    context: { summary: validated.summary, targets: validated.targets, impactAreas: impactAreas.map((area) => area.label) },
    personaCatalogue: options.personas ?? [],
    limit: 4
  });
  const routes = reviewRoutes(impactAreas, observed);
  const mapIsPartial = Boolean(
    index.sourceMap.outcomes.inventory_only
    || index.sourceMap.outcomes.skipped_sensitive
    || index.sourceMap.outcomes.skipped_oversized
    || index.sourceMap.outcomes.analysis_failed
    || index.sourceMap.depths.shallow
    || index.sourceMap.partial
  );
  const coverage = {
    complete: !mapIsPartial && !index.failed && !resolution.unresolvedTargets.length && !resolution.ambiguousTargets.length && !observed.truncated,
    indexed: index.indexed,
    parsed: index.parsed,
    failed: index.failed,
    unresolved: resolution.unresolvedTargets.length,
    ambiguous: resolution.ambiguousTargets.length,
    truncated: observed.truncated,
    sourceMap: index.sourceMap,
    warning: mapIsPartial || index.failed || resolution.unresolvedTargets.length || resolution.ambiguousTargets.length || observed.truncated
      ? `Coverage is partial. A narrow observed radius is not proof that nothing else changes.${index.sourceMap.warnings.length ? ` ${index.sourceMap.warnings.join(' ')}` : ''}`
      : ''
  };
  const previewId = sha256(JSON.stringify({ slug, runId: index.runId, ...validated })).slice(0, 16);
  return {
    schema: PREVIEW_SCHEMA,
    previewId,
    slug,
    summary: validated.summary,
    targets: validated.targets,
    policyDimensions: validated.policyDimensions,
    policyRelevantDigest: validated.policyRelevantDigest,
    index,
    coverage,
    ...resolution,
    observed,
    impactAreas,
    standards: applicableStandards(projectRoot, slug, resolution.resolvedTargets, observed),
    activePersonas,
    reviewRoutes: routes,
    guidance: { advisory: true, humanEvidenceTakesPriority: true, approvalsChanged: false }
  };
}

function evidenceRoot(projectRoot, slug) {
  return resolve(deliveryPaths(projectRoot, slug).deliveryRoot, 'impacts');
}

function singleLine(value) {
  return cleanText(value).replace(/\s+/g, ' ').replaceAll('`', "'");
}

function renderAssessment(record) {
  const nodeRows = record.observed.nodes.length
    ? record.observed.nodes.map((node) => `| \`${singleLine(node.path)}\` | ${node.direction} | ${node.distance} | ${node.relation} |`).join('\n')
    : '| — | — | — | No repository node resolved |';
  const impactRows = record.impactAreas.length
    ? record.impactAreas.map((area) => `| ${area.label} | inferred | ${area.signals.join(', ')} | ${area.evidencePaths.map((path) => `\`${singleLine(path)}\``).join(', ')} |`).join('\n')
    : '| No consequence inferred | inferred | — | — |';
  const personaRows = record.activePersonas.length
    ? record.activePersonas.map((persona) => `| ${singleLine(persona.name)} | ${persona.tier} | ${persona.matchedSignals.join(', ')} | ${singleLine(persona.engagementReason)} |`).join('\n')
    : '| No installed persona matched | — | — | — |';
  const routeRows = record.reviewRoutes.map((route) => `| ${route.label} | ${route.recommendation} | ${record.decisions[route.id]} | ${singleLine(record.rationales[route.id] ?? '') || '—'} |`).join('\n');
  return `# Impact Assessment — ${singleLine(record.slug)}

**Assessment:** \`${record.assessmentId}\`  
**Repository run:** ${record.index.runId}  
**Assessed by:** ${singleLine(record.assessor)}  
**Assessed at:** ${record.assessedAt}  
**Authority:** Advisory evidence only

## Proposed change

${singleLine(record.summary)}

Targets: ${record.targets.map((target) => `\`${singleLine(target)}\``).join(', ')}

Policy-material Impact digest: \`${record.policyRelevantDigest}\`. This digest changes only when explicit data, integration, hosting, AI-use, actor, or destination assumptions change.

## Observed repository evidence

| Path | Direction | Distance | Relationship |
| --- | --- | ---: | --- |
${nodeRows}

Coverage: ${record.coverage.complete ? 'complete within configured bounds' : record.coverage.warning}

## Inferred consequences

| Area | Authority | Signals | Evidence paths |
| --- | --- | --- | --- |
${impactRows}

## Active personas

| Persona | Tier | Matched concerns | Engagement reason |
| --- | --- | --- | --- |
${personaRows}

## Human review decisions

| Route | Recommendation | Decision | Rationale |
| --- | --- | --- | --- |
${routeRows}

## Boundary

This assessment does not approve Build, security, compliance, release, or Manual QA. Human evidence and accountable reviewers retain authority.
`;
}

export function confirmImpactAssessment(projectRoot, slug, input = {}, options = {}) {
  if (input.acknowledged !== true) throw failure('Impact assessment requires acknowledgement of evidence and coverage limits', 400);
  const assessor = cleanText(input.assessor);
  if (!assessor || assessor.length > 160) throw failure('Impact assessment requires a named assessor', 400);
  const preview = previewImpactAssessment(projectRoot, slug, input, options);
  if (Number(input.indexRunId) !== preview.index.runId) throw failure('The repository map changed since preview; analyse impact again');
  if (!input.decisions || typeof input.decisions !== 'object' || Array.isArray(input.decisions)) throw failure('Impact route decisions are required', 400);
  const rationales = input.rationales && typeof input.rationales === 'object' && !Array.isArray(input.rationales) ? input.rationales : {};
  const decisions = {};
  const safeRationales = {};
  for (const route of preview.reviewRoutes) {
    const decision = cleanText(input.decisions[route.id]);
    if (!routeDecisions.has(decision)) throw failure(`Impact route ${route.id} requires a valid decision`, 400);
    const rationale = cleanText(rationales[route.id] ?? rationales.override);
    if (decision !== route.recommendation && !rationale) throw failure(`A rationale is required when changing the ${route.label} recommendation`, 400);
    decisions[route.id] = decision;
    if (rationale) safeRationales[route.id] = rationale.slice(0, 1_000);
  }
  const identity = {
    slug,
    summary: preview.summary,
    targets: preview.targets,
    policyRelevantDigest: preview.policyRelevantDigest,
    indexRunId: preview.index.runId,
    decisions,
    rationales: safeRationales,
    assessor
  };
  const assessmentId = sha256(JSON.stringify(identity)).slice(0, 16);
  const assessedAt = options.now ?? new Date().toISOString();
  const record = {
    schema: ASSESSMENT_SCHEMA,
    assessmentId,
    slug,
    previewId: preview.previewId,
    summary: preview.summary,
    targets: preview.targets,
    policyDimensions: preview.policyDimensions,
    policyRelevantDigest: preview.policyRelevantDigest,
    index: preview.index,
    coverage: preview.coverage,
    resolvedTargets: preview.resolvedTargets,
    unresolvedTargets: preview.unresolvedTargets,
    ambiguousTargets: preview.ambiguousTargets,
    observed: preview.observed,
    impactAreas: preview.impactAreas,
    standards: preview.standards,
    activePersonas: preview.activePersonas,
    reviewRoutes: preview.reviewRoutes,
    decisions,
    rationales: safeRationales,
    assessor,
    acknowledged: true,
    assessedAt,
    authority: { advisory: true, approvalsChanged: false, humanEvidenceTakesPriority: true }
  };
  const root = evidenceRoot(projectRoot, slug);
  const jsonPath = resolve(root, `${assessmentId}.json`);
  const markdownPath = resolve(root, `${assessmentId}.md`);
  if (existsSync(jsonPath) || existsSync(markdownPath)) {
    if (!existsSync(jsonPath) || !existsSync(markdownPath)) throw failure(`Impact evidence ${assessmentId} is incomplete and will not be overwritten`);
    const existing = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const existingIdentity = {
      slug: existing.slug,
      summary: existing.summary,
      targets: existing.targets,
      policyRelevantDigest: existing.policyRelevantDigest,
      indexRunId: existing.index?.runId,
      decisions: existing.decisions,
      rationales: existing.rationales,
      assessor: existing.assessor
    };
    const existingAssessmentId = sha256(JSON.stringify(existingIdentity)).slice(0, 16);
    if (existing.assessmentId !== assessmentId || existingAssessmentId !== assessmentId) {
      throw failure(`Impact evidence ${assessmentId} already exists and will not be overwritten`);
    }
    return {
      schema: 'ewai.impact-confirmation/v1', status: 'recorded', assessmentId,
      evidence: { jsonPath: relative(resolve(projectRoot), jsonPath).replaceAll('\\', '/'), markdownPath: relative(resolve(projectRoot), markdownPath).replaceAll('\\', '/') },
      assessment: existing
    };
  }
  mkdirSync(dirname(jsonPath), { recursive: true });
  let jsonCreated = false;
  try {
    atomicJson(jsonPath, record);
    jsonCreated = true;
    atomicText(markdownPath, renderAssessment(record));
  } catch (error) {
    if (jsonCreated) rmSync(jsonPath, { force: true });
    rmSync(markdownPath, { force: true });
    throw error;
  }
  return {
    schema: 'ewai.impact-confirmation/v1', status: 'recorded', assessmentId,
    evidence: { jsonPath: relative(resolve(projectRoot), jsonPath).replaceAll('\\', '/'), markdownPath: relative(resolve(projectRoot), markdownPath).replaceAll('\\', '/') },
    assessment: record
  };
}

export function readImpactWorkspace(projectRoot, slug) {
  deliveryPaths(projectRoot, slug);
  const status = repositoryIndexStatus(projectRoot);
  const freshness = repositoryIndexFreshness(projectRoot);
  const sourceMap = repositorySourceMapCoverage(projectRoot);
  const root = evidenceRoot(projectRoot, slug);
  const assessments = existsSync(root)
    ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).flatMap((entry) => {
      try {
        const record = JSON.parse(readFileSync(resolve(root, entry.name), 'utf8'));
        if (record.schema !== ASSESSMENT_SCHEMA) return [];
        return [{
          assessmentId: record.assessmentId,
          summary: record.summary,
          assessor: record.assessor,
          assessedAt: record.assessedAt,
          policyDimensions: record.policyDimensions,
          policyRelevantDigest: record.policyRelevantDigest,
          coverage: record.coverage,
          decisions: record.decisions,
          activePersonas: record.activePersonas,
          jsonPath: relative(resolve(projectRoot), resolve(root, entry.name)).replaceAll('\\', '/'),
          markdownPath: relative(resolve(projectRoot), resolve(root, `${record.assessmentId}.md`)).replaceAll('\\', '/')
        }];
      } catch {
        return [];
      }
    }).sort((left, right) => String(right.assessedAt).localeCompare(String(left.assessedAt)))
    : [];
  return {
    schema: 'ewai.impact-workspace/v1',
    slug,
    index: {
      status: status.status,
      runId: status.run?.id ?? null,
      fresh: status.status === 'completed' && !freshness.stale,
      indexed: Number(status.counts?.files ?? 0),
      parsed: Number(status.counts?.parsed ?? 0),
      failed: Number(status.counts?.failed ?? 0),
      freshness,
      sourceMap
    },
    assessments,
    limits: { summaryCharacters: MAX_SUMMARY, targets: MAX_TARGETS, targetCharacters: MAX_TARGET, depth: MAX_DEPTH, nodes: MAX_NODES },
    guidance: { advisory: true, approvalsChanged: false, humanEvidenceTakesPriority: true }
  };
}
