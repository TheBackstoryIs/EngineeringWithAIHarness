import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { extractTreeSitterFacts } from './runtime/tree-sitter-index.mjs';
import { listProjectPacks } from './packs.mjs';
import { safePlatformFailureCode } from './platform-metadata-analysis.mjs';
import { analysePowerPlatformMetadata, powerPlatformLayout } from './power-platform-source-map.mjs';
import { loadProjectConfig } from './project.mjs';
import { analyseSalesforceMetadata, salesforceLayout } from './salesforce-source-map.mjs';

export const SOURCE_MAP_MAX_FILE_BYTES = 900_000;

const core = (id, patterns, classification, analyser, analysisDepth, priority = 0) => Object.freeze({
  id, patterns: Object.freeze(patterns), classification, analyser, analysisDepth, priority,
  repositories: Object.freeze([]), maxBytes: SOURCE_MAP_MAX_FILE_BYTES, sourceKind: 'core', sourceRef: 'ewai.core'
});

export const REGISTERED_SOURCE_MAP_ANALYSERS = Object.freeze([
  'inventory-only', 'text-summary', 'structured-keys', 'tree-sitter',
  'power-platform-metadata', 'salesforce-metadata'
]);

export const CORE_SOURCE_MAP_PROFILES = Object.freeze([
  core('core-sensitive', [], 'sensitive-config', 'inventory-only', 'inventory', 10_000),
  core('core-tree-sitter-php', ['**/*.php'], 'source-code', 'tree-sitter', 'deep'),
  core('core-tree-sitter-javascript', ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'], 'source-code', 'tree-sitter', 'deep'),
  core('core-tree-sitter-typescript', ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.tsx'], 'source-code', 'tree-sitter', 'deep'),
  core('core-tree-sitter-vue', ['**/*.vue'], 'source-code', 'tree-sitter', 'deep'),
  core('core-structured-json', ['**/*.json', '**/*.jsonc'], 'structured-data', 'structured-keys', 'shallow'),
  core('core-structured-yaml', ['**/*.yaml', '**/*.yml'], 'structured-data', 'structured-keys', 'shallow'),
  core('core-structured-toml', ['**/*.toml'], 'structured-data', 'structured-keys', 'shallow'),
  core('core-structured-xml', ['**/*.xml', '**/*.svg'], 'structured-data', 'structured-keys', 'shallow'),
  core('core-structured-ini', ['**/*.ini', '**/*.properties'], 'structured-data', 'structured-keys', 'shallow'),
  core('core-structured-env-template', ['**/.env.example', '**/.env.sample', '**/.env.template'], 'configuration-template', 'structured-keys', 'shallow', 20),
  core('core-documentation', ['**/*.md', '**/*.mdx', '**/*.txt', '**/*.rst', '**/*.adoc', '**/Dockerfile', '**/Makefile', '**/Procfile', '**/Gemfile', '**/Rakefile'], 'documentation', 'text-summary', 'shallow'),
  core('core-shallow-source', ['**/*.astro', '**/*.bash', '**/*.c', '**/*.cc', '**/*.cpp', '**/*.cs', '**/*.css', '**/*.fish', '**/*.go', '**/*.gql', '**/*.graphql', '**/*.h', '**/*.hpp', '**/*.htm', '**/*.html', '**/*.java', '**/*.kt', '**/*.kts', '**/*.less', '**/*.lua', '**/*.pl', '**/*.ps1', '**/*.py', '**/*.r', '**/*.rb', '**/*.rs', '**/*.sass', '**/*.scala', '**/*.scss', '**/*.sh', '**/*.sql', '**/*.svelte', '**/*.swift', '**/*.zsh'], 'source-code', 'text-summary', 'shallow'),
  core('core-binary', [], 'binary', 'inventory-only', 'inventory'),
  core('core-fallback', ['**/*'], 'unknown', 'inventory-only', 'inventory', -10_000)
]);

const profilesById = new Map(CORE_SOURCE_MAP_PROFILES.map((profile) => [profile.id, profile]));
const sensitiveNames = new Set(['.env', '.npmrc', '.netrc']);
const sourceRanks = Object.freeze({ core: 0, technology: 1, stack: 2, organisation: 3, project: 4 });
const allowedProfileFields = new Set([
  'id', 'patterns', 'analyser', 'classification', 'priority', 'repositories', 'max_bytes'
]);
const profileIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const packIdPattern = /^(?:ewai\.[a-z0-9.-]+|org\.[a-z0-9-]+\.[a-z0-9.-]+)$/;
const classificationPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const globCache = new Map();

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function profile(id) {
  return profilesById.get(id);
}

function isSensitiveName(name) {
  const lower = name.toLowerCase();
  if (sensitiveNames.has(lower)) return true;
  if (!lower.startsWith('.env.')) return false;
  return !['.env.example', '.env.sample', '.env.template'].includes(lower);
}

function safePattern(pattern) {
  const value = String(pattern ?? '').trim();
  const segments = value.split('/');
  if (!value || value.length > 240 || value.startsWith('/') || value.startsWith('!')
    || value.includes('\\') || value.includes('\0') || segments.includes('..')
    || /[{}()[\]]/.test(value)) {
    throw new Error(`unsafe source map pattern: ${value || '<empty>'}`);
  }
  return value;
}

function globRegex(pattern) {
  const safe = safePattern(pattern);
  if (globCache.has(safe)) return globCache.get(safe);
  let expression = '^';
  for (let index = 0; index < safe.length;) {
    if (safe[index] === '*' && safe[index + 1] === '*') {
      if (safe[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 3;
      } else {
        expression += '.*';
        index += 2;
      }
      continue;
    }
    if (safe[index] === '*') {
      expression += '[^/]*';
      index += 1;
      continue;
    }
    if (safe[index] === '?') {
      expression += '[^/]';
      index += 1;
      continue;
    }
    expression += safe[index].replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    index += 1;
  }
  const compiled = new RegExp(`${expression}$`);
  globCache.set(safe, compiled);
  return compiled;
}

function sourceKindForPack(pack) {
  if (pack.type === 'core') return 'core';
  if (pack.type === 'organisation') return 'organisation';
  if (pack.type === 'stack') return 'stack';
  return 'technology';
}

function namespacedProfileId(id, sourceKind, sourceRef) {
  if (sourceKind === 'core') return id;
  if (sourceKind === 'project') return `project:${id}`;
  return `${sourceRef}:${id}`;
}

export function validateSourceMapProfile(value, context = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Source map profile must be an object.');
  }
  const unsupported = Object.keys(value).find((key) => !allowedProfileFields.has(key));
  if (unsupported) throw new Error(`unsupported source map profile field: ${unsupported}`);
  const id = String(value.id ?? '').trim();
  if (!profileIdPattern.test(id)) throw new Error(`Invalid source map profile id: ${id || '<empty>'}`);
  const patterns = Array.isArray(value.patterns) ? value.patterns.map(safePattern) : [];
  if (!patterns.length) throw new Error(`Source map profile ${id} requires at least one pattern.`);
  const analyser = String(value.analyser ?? '').trim();
  if (!REGISTERED_SOURCE_MAP_ANALYSERS.includes(analyser)) {
    throw new Error(`unknown source map analyser: ${analyser || '<empty>'}`);
  }
  const classification = String(value.classification ?? '').trim();
  if (!classificationPattern.test(classification)) {
    throw new Error(`Invalid source map classification: ${classification || '<empty>'}`);
  }
  const priority = Number(value.priority ?? 0);
  if (!Number.isInteger(priority) || priority < -10_000 || priority > 10_000) {
    throw new Error(`Source map profile ${id} priority must be an integer between -10000 and 10000.`);
  }
  const repositories = value.repositories ?? [];
  if (!Array.isArray(repositories) || repositories.some((repository) => !String(repository).trim())) {
    throw new Error(`Source map profile ${id} repositories must be non-empty strings.`);
  }
  const maxBytes = Number(value.max_bytes ?? SOURCE_MAP_MAX_FILE_BYTES);
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > SOURCE_MAP_MAX_FILE_BYTES) {
    throw new Error(`Source map profile ${id} max_bytes must be between 1 and ${SOURCE_MAP_MAX_FILE_BYTES}.`);
  }
  const sourceKind = context.sourceKind ?? 'project';
  const sourceRef = context.sourceRef ?? (sourceKind === 'project' ? 'pipeline.yaml' : 'unknown');
  if (!(sourceKind in sourceRanks)) throw new Error(`Unsupported source map profile source: ${sourceKind}`);
  return {
    id: namespacedProfileId(id, sourceKind, sourceRef),
    localId: id,
    patterns,
    analyser,
    classification,
    priority,
    repositories: [...new Set(repositories.map((repository) => String(repository).trim()))].sort(),
    maxBytes,
    analysisDepth: ['tree-sitter', 'power-platform-metadata', 'salesforce-metadata'].includes(analyser)
      ? 'deep'
      : analyser === 'inventory-only' ? 'inventory' : 'shallow',
    sourceKind,
    sourceRef,
    sourceVersion: String(context.sourceVersion ?? '')
  };
}

function activePackIds(selected, catalogue) {
  for (const pack of catalogue) {
    if (!packIdPattern.test(String(pack.id ?? ''))) {
      throw new Error(`Invalid EWAI pack id in installed catalogue: ${pack.id ?? '<empty>'}`);
    }
  }
  const byId = new Map(catalogue.map((pack) => [pack.id, pack]));
  const active = [];
  const visiting = new Set();
  const visit = (id) => {
    if (active.includes(id)) return;
    if (visiting.has(id)) throw new Error(`Circular EWAI pack dependency: ${id}`);
    const pack = byId.get(id);
    if (!pack) throw new Error(`Unknown configured EWAI pack: ${id}`);
    visiting.add(id);
    for (const requirement of pack.requires ?? []) visit(requirement);
    visiting.delete(id);
    active.push(id);
  };
  for (const id of selected) visit(id);
  return active;
}

export function sourceMapProfileDigest(profiles) {
  const canonical = [...profiles].map((item) => ({
    id: item.id,
    patterns: [...(item.patterns ?? [])].sort(),
    analyser: item.analyser,
    classification: item.classification,
    priority: Number(item.priority ?? 0),
    repositories: [...(item.repositories ?? [])].sort(),
    maxBytes: Number(item.maxBytes ?? SOURCE_MAP_MAX_FILE_BYTES),
    analysisDepth: item.analysisDepth,
    sourceKind: item.sourceKind,
    sourceRef: item.sourceRef,
    sourceVersion: item.sourceVersion ?? ''
  })).sort((left, right) => left.id.localeCompare(right.id));
  return hash(JSON.stringify(canonical));
}

export function resolveSourceMapProfiles(projectRoot, options = {}) {
  const { config } = options.config ? { config: options.config } : loadProjectConfig(projectRoot);
  const catalogue = options.packs ?? listProjectPacks(projectRoot, {
    ...(options.packRoots ? { roots: options.packRoots } : {}),
    ...(options.home ? { home: options.home } : {})
  });
  const selected = [...new Set(['ewai.core', ...(config.packs ?? [])])];
  const activePacks = activePackIds(selected, catalogue);
  const byId = new Map(catalogue.map((pack) => [pack.id, pack]));
  const profiles = [...CORE_SOURCE_MAP_PROFILES];
  for (const id of activePacks) {
    const pack = byId.get(id);
    const sourceKind = sourceKindForPack(pack);
    for (const value of pack.source_map?.profiles ?? []) {
      profiles.push(validateSourceMapProfile(value, {
        sourceKind,
        sourceRef: pack.id,
        sourceVersion: pack.version
      }));
    }
  }
  for (const value of config.source_map?.profiles ?? []) {
    profiles.push(validateSourceMapProfile(value, { sourceKind: 'project', sourceRef: 'pipeline.yaml' }));
  }
  const duplicate = profiles.find((item, index) => profiles.findIndex((candidate) => candidate.id === item.id) !== index);
  if (duplicate) throw new Error(`Duplicate source map profile id: ${duplicate.id}`);
  return {
    schema: 'ewai.source-map-profiles/v1',
    activePacks,
    profiles,
    digest: sourceMapProfileDigest(profiles)
  };
}

function matchesRepository(profileValue, repository) {
  if (!profileValue.repositories?.length) return true;
  if (!repository) return false;
  return profileValue.repositories.includes(repository.name) || profileValue.repositories.includes(repository.role);
}

function profileMatches(profileValue, path) {
  return profileValue.patterns?.some((pattern) => globRegex(pattern).test(path)) ?? false;
}

export function selectSourceMapProfile(path, options = {}) {
  const name = basename(path);
  if (isSensitiveName(name)) return profile('core-sensitive');
  const candidatePath = String(path).replaceAll('\\', '/').replace(/^\.\//, '');
  const profiles = options.profiles ?? CORE_SOURCE_MAP_PROFILES;
  return profiles
    .filter((item) => item.id !== 'core-sensitive' && item.id !== 'core-binary')
    .filter((item) => matchesRepository(item, options.repository) && profileMatches(item, candidatePath))
    .sort((left, right) => (sourceRanks[right.sourceKind] - sourceRanks[left.sourceKind])
      || (Number(right.priority ?? 0) - Number(left.priority ?? 0))
      || left.id.localeCompare(right.id))[0]
    ?? profile('core-fallback');
}

export function sourceMapProfileFileLimit(profileValue) {
  return Math.min(SOURCE_MAP_MAX_FILE_BYTES, Number(profileValue?.maxBytes ?? SOURCE_MAP_MAX_FILE_BYTES));
}

function metadataFingerprint(sizeBytes, modifiedMs, state) {
  return hash(`ewai-source-map:${state}:${sizeBytes}:${Math.floor(Number(modifiedMs ?? 0))}`);
}

export function fingerprintRepositoryFile(path, stat, selectedProfile = selectSourceMapProfile(path)) {
  const sizeBytes = Number(stat?.size ?? 0);
  if (selectedProfile.id === 'core-sensitive') {
    return { kind: 'metadata-sha256', value: metadataFingerprint(sizeBytes, stat?.mtimeMs, 'sensitive') };
  }
  if (sizeBytes > sourceMapProfileFileLimit(selectedProfile)) {
    return { kind: 'metadata-sha256', value: metadataFingerprint(sizeBytes, stat?.mtimeMs, 'oversized') };
  }
  try {
    return { kind: 'sha256', value: hash(readFileSync(path)) };
  } catch {
    return { kind: 'metadata-sha256', value: metadataFingerprint(sizeBytes, stat?.mtimeMs, 'unreadable') };
  }
}

export function fingerprintRepositoryBuffer(buffer) {
  return { kind: 'sha256', value: hash(buffer) };
}

function isProbablyBinary(buffer) {
  if (!buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.2;
}

function collectObjectKeys(value, prefix = '', keys = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectObjectKeys(entry, prefix, keys);
    return keys;
  }
  if (!value || typeof value !== 'object') return keys;
  for (const key of Object.keys(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    keys.add(path);
    collectObjectKeys(value[key], path, keys);
  }
  return keys;
}

function stripJsonComments(content) {
  let output = '';
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    const next = content[index + 1];
    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
        output += current;
      } else {
        output += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        output += '  ';
        blockComment = false;
        index += 1;
      } else {
        output += current === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = '';
      continue;
    }
    if (current === '"') {
      quote = current;
      output += current;
      continue;
    }
    if (current === '/' && next === '/') {
      lineComment = true;
      output += '  ';
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      output += '  ';
      index += 1;
      continue;
    }
    output += current;
  }
  return output.replace(/,\s*([}\]])/g, '$1');
}

function structuredKeys(path, content) {
  const lowerName = basename(path).toLowerCase();
  const extension = extname(lowerName);
  if (extension === '.json' || extension === '.jsonc') {
    const parsed = JSON.parse(stripJsonComments(content.replace(/^\uFEFF/, '')));
    return [...collectObjectKeys(parsed)].sort();
  }
  if (extension === '.yaml' || extension === '.yml') {
    const document = parseDocument(content, { maxAliasCount: 0, prettyErrors: false });
    if (document.errors.length) throw new Error('invalid-yaml');
    return [...collectObjectKeys(document.toJS({ maxAliasCount: 0 }))].sort();
  }
  if (extension === '.toml') {
    const keys = new Set();
    let section = '';
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      const sectionMatch = line.match(/^\[([^\]]+)]$/);
      if (sectionMatch) {
        section = sectionMatch[1].trim();
        keys.add(section);
        continue;
      }
      const keyMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=/);
      if (keyMatch) keys.add(section ? `${section}.${keyMatch[1]}` : keyMatch[1]);
    }
    return [...keys].sort();
  }
  if (extension === '.xml' || extension === '.svg') {
    return [...new Set([...content.matchAll(/<\/?([A-Za-z_][\w:.-]*)\b/g)].map((match) => match[1]))].sort();
  }
  if (extension === '.ini' || extension === '.properties') {
    const keys = new Set();
    let section = '';
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      const sectionMatch = line.match(/^\[([^\]]+)]$/);
      if (sectionMatch) {
        section = sectionMatch[1].trim();
        keys.add(section);
        continue;
      }
      const keyMatch = line.match(/^([^=:#;]+?)\s*[:=]/);
      if (keyMatch) {
        const key = keyMatch[1].trim();
        keys.add(section ? `${section}.${key}` : key);
      }
    }
    return [...keys].sort();
  }
  if (['.env.example', '.env.sample', '.env.template'].includes(lowerName)) {
    return [...new Set(content.split(/\r?\n/)
      .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
      .filter(Boolean))].sort();
  }
  throw new Error('unsupported-structured-format');
}

function emptyFacts(file) {
  return { file, symbols: [], relationships: [], imports: [], spans: [] };
}

function baseFile(profileValue, sizeBytes, fingerprint, outcome, overrides = {}) {
  return {
    language: '',
    parser: '',
    parserStatus: 'not_applicable',
    sizeBytes,
    lineCount: 0,
    parseErrorCount: 0,
    metadata: {},
    classification: profileValue.classification,
    profileId: profileValue.id,
    analyser: profileValue.analyser,
    analysisDepth: profileValue.analysisDepth,
    analysisOutcome: outcome,
    fingerprintKind: fingerprint.kind,
    fingerprint: fingerprint.value,
    ...overrides
  };
}

function platformFailure(selectedProfile, path, sizeBytes, fingerprint, error, content) {
  const power = selectedProfile.analyser === 'power-platform-metadata';
  const platform = power ? 'power-platform' : 'salesforce';
  const layout = (power ? powerPlatformLayout(path) : salesforceLayout(path)) || 'unknown';
  const failureCode = safePlatformFailureCode(error);
  return emptyFacts(baseFile(selectedProfile, sizeBytes, fingerprint, 'analysis_failed', {
    language: path.toLowerCase().endsWith('.json') ? 'json'
      : path.toLowerCase().endsWith('.xml') ? 'xml' : 'yaml',
    parser: power ? 'ewai-power-platform-metadata/v1' : 'ewai-salesforce-metadata/v1',
    parserStatus: 'failed',
    lineCount: content ? content.split(/\r?\n/).length : 0,
    parseErrorCount: 1,
    metadata: {
      platform,
      layout,
      partial: true,
      truncated: failureCode === 'platform-analysis-limit',
      unknown_component_count: 0,
      failure_code: failureCode
    }
  }));
}

function analysePlatformFile(path, content, selectedProfile, sizeBytes, fingerprint) {
  try {
    const facts = selectedProfile.analyser === 'power-platform-metadata'
      ? analysePowerPlatformMetadata(path, content)
      : analyseSalesforceMetadata(path, content);
    return {
      ...facts,
      file: baseFile(selectedProfile, sizeBytes, fingerprint, 'analysed', facts.file)
    };
  } catch (error) {
    return platformFailure(selectedProfile, path, sizeBytes, fingerprint, error, content);
  }
}

export function analyseRepositoryFile(path, options = {}) {
  const selectedProfile = options.profile ?? selectSourceMapProfile(path);
  const sizeBytes = Number(options.stat?.size ?? options.buffer?.length ?? 0);
  const fileLimit = sourceMapProfileFileLimit(selectedProfile);
  let buffer = options.buffer ?? null;
  let readError = Boolean(options.readError);
  if (!buffer && !readError && selectedProfile.id !== 'core-sensitive' && sizeBytes <= fileLimit) {
    try {
      buffer = readFileSync(path);
    } catch {
      readError = true;
    }
  }
  const fingerprint = options.fingerprint
    ?? (buffer ? fingerprintRepositoryBuffer(buffer) : fingerprintRepositoryFile(path, options.stat, selectedProfile));
  if (selectedProfile.id === 'core-sensitive') {
    return emptyFacts(baseFile(selectedProfile, sizeBytes, fingerprint, 'skipped_sensitive'));
  }
  if (sizeBytes > fileLimit) {
    return emptyFacts(baseFile(selectedProfile, sizeBytes, fingerprint, 'skipped_oversized', {
      analyser: 'inventory-only',
      analysisDepth: 'inventory'
    }));
  }
  if (readError) {
    return emptyFacts(baseFile(selectedProfile, sizeBytes, fingerprint, 'analysis_failed', {
      analyser: 'inventory-only',
      analysisDepth: 'inventory',
      parserStatus: 'failed',
      metadata: { failure_code: 'read-failed' }
    }));
  }

  if (isProbablyBinary(buffer)) {
    const binaryProfile = profile('core-binary');
    return emptyFacts(baseFile(binaryProfile, sizeBytes, fingerprint, 'inventory_only'));
  }
  const content = buffer.toString('utf8');
  if (['power-platform-metadata', 'salesforce-metadata'].includes(selectedProfile.analyser)) {
    return analysePlatformFile(path, content, selectedProfile, sizeBytes, fingerprint);
  }
  if (selectedProfile.analyser === 'tree-sitter') {
    const facts = extractTreeSitterFacts(path, content, {
      repo: options.repo ?? 'application',
      repoRelative: options.repoRelative ?? ((candidate) => candidate)
    });
    if (facts.file.parserStatus === 'not_applicable') {
      return emptyFacts(baseFile(selectedProfile, sizeBytes, fingerprint, 'analysis_failed', {
        parserStatus: 'failed',
        parseErrorCount: 1,
        metadata: { failure_code: 'unregistered-tree-sitter-grammar' }
      }));
    }
    return {
      ...facts,
      file: {
        ...facts.file,
        metadata: facts.file.parserStatus === 'failed'
          ? { failure_code: 'tree-sitter-analysis-failed' }
          : facts.file.metadata,
        classification: selectedProfile.classification,
        profileId: selectedProfile.id,
        analyser: selectedProfile.analyser,
        analysisDepth: selectedProfile.analysisDepth,
        analysisOutcome: facts.file.parserStatus === 'failed' ? 'analysis_failed' : 'analysed',
        fingerprintKind: fingerprint.kind,
        fingerprint: fingerprint.value
      }
    };
  }
  if (selectedProfile.analyser === 'structured-keys') {
    try {
      const keys = structuredKeys(path, content);
      return emptyFacts(baseFile(selectedProfile, sizeBytes, fingerprint, 'analysed', {
        lineCount: content ? content.split(/\r?\n/).length : 0,
        metadata: { structural_keys: keys }
      }));
    } catch {
      return emptyFacts(baseFile(selectedProfile, sizeBytes, fingerprint, 'analysis_failed', {
        lineCount: content ? content.split(/\r?\n/).length : 0,
        parserStatus: 'failed',
        parseErrorCount: 1,
        metadata: { failure_code: 'invalid-structured-document' }
      }));
    }
  }
  if (selectedProfile.analyser === 'text-summary') {
    const lines = content ? content.split(/\r?\n/) : [];
    return emptyFacts(baseFile(selectedProfile, sizeBytes, fingerprint, 'analysed', {
      lineCount: lines.length,
      metadata: {
        non_empty_line_count: lines.filter((line) => line.trim()).length,
        maximum_line_length: lines.reduce((maximum, line) => Math.max(maximum, line.length), 0)
      }
    }));
  }
  return emptyFacts(baseFile(selectedProfile, sizeBytes, fingerprint, 'inventory_only'));
}

export function coreSourceMapProfileDigest() {
  return sourceMapProfileDigest(CORE_SOURCE_MAP_PROFILES);
}
