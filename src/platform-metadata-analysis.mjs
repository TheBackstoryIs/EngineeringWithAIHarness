import { isAlias, parseDocument, visit } from 'yaml';

export const PLATFORM_METADATA_LIMITS = Object.freeze({
  identifierLength: 240,
  symbols: 1_000,
  relationships: 2_000,
  nodes: 20_000,
  depth: 96
});

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/@#{}-]*$/;
const safeFailureCodes = new Set([
  'invalid-platform-document',
  'unsafe-xml-declaration',
  'platform-analysis-limit',
  'unsupported-platform-layout'
]);

export class PlatformAnalysisError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'PlatformAnalysisError';
    this.code = safeFailureCodes.has(code) ? code : 'invalid-platform-document';
  }
}

function fail(code) {
  throw new PlatformAnalysisError(code);
}

export function normalisePlatformIdentifier(value, limit = PLATFORM_METADATA_LIMITS.identifierLength) {
  const identifier = String(value ?? '').trim();
  if (!identifier || identifier.length > limit || !identifierPattern.test(identifier)) return '';
  return identifier;
}

export function normalisePlatformPathIdentifier(value, limit = PLATFORM_METADATA_LIMITS.identifierLength) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.includes('\\') || raw.startsWith('/')) return '';
  const identifier = normalisePlatformIdentifier(raw, limit);
  if (!identifier) return '';
  const segments = identifier.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return identifier;
}

function safeEnum(value, allowed) {
  const candidate = String(value ?? '').trim();
  return allowed.has(candidate) ? candidate : '';
}

function safeBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function safeFactMetadata(platform, metadata = {}) {
  const result = { platform };
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'boolean') result[key] = value;
    else if (Number.isInteger(value) && value >= 0 && value <= PLATFORM_METADATA_LIMITS.nodes) result[key] = value;
    else if (key === 'component_type') {
      const identifier = normalisePlatformIdentifier(value);
      if (identifier) result[key] = identifier;
    } else if (key === 'visibility') {
      const visibility = safeEnum(value, new Set(['DefaultOn', 'DefaultOff', 'Hidden']));
      if (visibility) result[key] = visibility;
    }
  }
  return result;
}

export function createPlatformFactCollector(options = {}) {
  const platform = safeEnum(options.platform, new Set(['power-platform', 'salesforce']));
  const layout = normalisePlatformIdentifier(options.layout);
  if (!platform || !layout) fail('unsupported-platform-layout');
  const limits = { ...PLATFORM_METADATA_LIMITS, ...(options.limits ?? {}) };
  const symbols = [];
  const relationships = [];
  const symbolKeys = new Set();
  const relationshipKeys = new Set();
  let partial = Boolean(options.partial);
  let truncated = false;
  let unknownComponentCount = Number(options.unknownComponentCount ?? 0);

  const markOmitted = (count = 1, wasTruncated = false) => {
    partial = true;
    truncated ||= wasTruncated;
    unknownComponentCount += Math.max(0, Number(count) || 0);
  };

  const addSymbol = (kind, name, metadata = {}) => {
    const safeKind = normalisePlatformIdentifier(kind);
    const safeName = normalisePlatformIdentifier(name, limits.identifierLength);
    if (!safeKind || !safeName) {
      markOmitted();
      return false;
    }
    const key = `${safeKind}\u0000${safeName}`;
    if (symbolKeys.has(key)) return true;
    if (symbols.length >= limits.symbols) {
      markOmitted(1, true);
      return false;
    }
    symbolKeys.add(key);
    symbols.push({
      kind: safeKind,
      name: safeName,
      line: null,
      signature: '',
      tags: [platform, safeKind],
      metadata: safeFactMetadata(platform, metadata)
    });
    return true;
  };

  const addRelationship = (sourceKind, sourceName, relationshipKind, targetKind, targetName, metadata = {}) => {
    const values = [sourceKind, sourceName, relationshipKind, targetKind, targetName]
      .map((value) => normalisePlatformIdentifier(value, limits.identifierLength));
    if (values.some((value) => !value)) {
      markOmitted();
      return false;
    }
    const key = values.join('\u0000');
    if (relationshipKeys.has(key)) return true;
    if (relationships.length >= limits.relationships) {
      markOmitted(1, true);
      return false;
    }
    relationshipKeys.add(key);
    relationships.push({
      source_kind: values[0],
      source_name: values[1],
      source_path: '',
      relationship_kind: values[2],
      target_kind: values[3],
      target_name: values[4],
      target_path: '',
      metadata: safeFactMetadata(platform, metadata)
    });
    return true;
  };

  return {
    addSymbol,
    addRelationship,
    markPartial: (count = 0) => markOmitted(count, false),
    markTruncated: (count = 0) => markOmitted(count, true),
    finish(extraMetadata = {}) {
      const formatVersion = normalisePlatformIdentifier(extraMetadata.format_version);
      return {
        symbols,
        relationships,
        imports: [],
        spans: [],
        metadata: {
          platform,
          layout,
          ...(formatVersion ? { format_version: formatVersion } : {}),
          partial,
          truncated,
          unknown_component_count: unknownComponentCount,
          symbol_count: symbols.length,
          relationship_count: relationships.length
        }
      };
    }
  };
}

function decodeXmlText(value) {
  return String(value ?? '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .trim();
}

function xmlName(value) {
  return String(value ?? '').split(':').pop();
}

function parseAttributes(fragment) {
  const attributes = {};
  const withoutAttributes = fragment.replace(/([:@A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    (_, name, doubleQuoted, singleQuoted) => {
      attributes[xmlName(name)] = decodeXmlText(doubleQuoted ?? singleQuoted ?? '');
      return ' ';
    });
  if (withoutAttributes.trim()) fail('invalid-platform-document');
  return attributes;
}

export function parseSafePlatformXml(content, options = {}) {
  const source = String(content ?? '');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) fail('unsafe-xml-declaration');
  const limits = { ...PLATFORM_METADATA_LIMITS, ...(options.limits ?? {}) };
  const document = { name: '#document', attributes: {}, children: [], text: '' };
  const stack = [document];
  const tokenPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>/g;
  let cursor = 0;
  let nodes = 0;
  for (const match of source.matchAll(tokenPattern)) {
    const text = decodeXmlText(source.slice(cursor, match.index));
    if (text) stack.at(-1).text += text;
    cursor = match.index + match[0].length;
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<![CDATA[') || token.startsWith('<?')) continue;
    if (token.startsWith('<!')) fail('invalid-platform-document');
    if (token.startsWith('</')) {
      const closing = xmlName(token.slice(2, -1).trim());
      if (stack.length === 1 || stack.at(-1).name !== closing) fail('invalid-platform-document');
      stack.pop();
      continue;
    }
    const selfClosing = /\/\s*>$/.test(token);
    const inner = token.slice(1, selfClosing ? token.lastIndexOf('/') : -1).trim();
    const nameMatch = inner.match(/^([A-Za-z_][\w:.-]*)([\s\S]*)$/);
    if (!nameMatch) fail('invalid-platform-document');
    nodes += 1;
    if (nodes > limits.nodes || stack.length > limits.depth) fail('platform-analysis-limit');
    const node = {
      name: xmlName(nameMatch[1]),
      attributes: parseAttributes(nameMatch[2]),
      children: [],
      text: ''
    };
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  const trailing = decodeXmlText(source.slice(cursor));
  if (trailing) stack.at(-1).text += trailing;
  if (stack.length !== 1 || document.children.length !== 1) fail('invalid-platform-document');
  return document.children[0];
}

export function parseSafePlatformYaml(content, options = {}) {
  const limits = { ...PLATFORM_METADATA_LIMITS, ...(options.limits ?? {}) };
  try {
    const document = parseDocument(String(content ?? ''), { maxAliasCount: 0, prettyErrors: false });
    if (document.errors.length) fail('invalid-platform-document');
    let aliasFound = false;
    visit(document, { Alias: (_key, node) => { if (isAlias(node)) aliasFound = true; } });
    if (aliasFound) fail('invalid-platform-document');
    const value = document.toJS({ maxAliasCount: 0 });
    assertBoundedPlatformStructure(value, limits);
    return value;
  } catch (error) {
    if (error instanceof PlatformAnalysisError) throw error;
    fail('invalid-platform-document');
  }
}

export function assertBoundedPlatformStructure(value, limits = PLATFORM_METADATA_LIMITS) {
  let nodes = 0;
  const walk = (current, depth) => {
    nodes += 1;
    if (nodes > limits.nodes || depth > limits.depth) fail('platform-analysis-limit');
    if (Array.isArray(current)) {
      for (const entry of current) walk(entry, depth + 1);
      return;
    }
    if (!current || typeof current !== 'object') return;
    for (const entry of Object.values(current)) walk(entry, depth + 1);
  };
  walk(value, 0);
  return { nodes };
}

export function platformFactsFile(facts, options = {}) {
  return {
    file: {
      language: options.language ?? '',
      parser: options.parser ?? 'ewai-platform-metadata/v1',
      parserStatus: 'parsed',
      lineCount: String(options.content ?? '').split(/\r?\n/).length,
      parseErrorCount: 0,
      metadata: facts.metadata
    },
    symbols: facts.symbols,
    relationships: facts.relationships,
    imports: [],
    spans: []
  };
}

export function safePlatformFailureCode(error) {
  return safeFailureCodes.has(error?.code) ? error.code : 'invalid-platform-document';
}

export function xmlChildren(node, name) {
  const expected = String(name).toLowerCase();
  return (node?.children ?? []).filter((child) => child.name.toLowerCase() === expected);
}

export function xmlDescendants(node, name, found = []) {
  const expected = String(name).toLowerCase();
  for (const child of node?.children ?? []) {
    if (child.name.toLowerCase() === expected) found.push(child);
    xmlDescendants(child, name, found);
  }
  return found;
}

export function xmlChildText(node, name) {
  return xmlChildren(node, name)[0]?.text?.trim() ?? '';
}

export function platformBoolean(value) {
  return safeBoolean(value);
}
