import Parser from 'tree-sitter';
import Php from 'tree-sitter-php';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import { extname } from 'node:path';

const parserVersion = 'tree-sitter@0.21.1';
const maxSnippetLength = 320;

const languages = {
  php: Php.php,
  js: JavaScript,
  ts: TypeScript.typescript,
  tsx: TypeScript.tsx
};

function parserFor(language) {
  const grammar = languages[language];
  if (!grammar) return null;
  const parser = new Parser();
  parser.setLanguage(grammar);
  return parser;
}

function languageForPath(path) {
  const extension = extname(path);
  if (extension === '.php') return 'php';
  if (['.js', '.mjs', '.cjs', '.jsx'].includes(extension)) return 'js';
  if (['.ts', '.mts', '.cts'].includes(extension)) return 'ts';
  if (extension === '.tsx') return 'tsx';
  if (extension === '.vue') return 'vue';
  return '';
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function lineCount(content) {
  return content ? content.split(/\r?\n/).length : 0;
}

function pointLine(point) {
  return Number(point?.row ?? 0) + 1;
}

function childText(node, type) {
  const child = node.namedChildren.find((candidate) => candidate.type === type);
  return child?.text ?? '';
}

function childByType(node, type) {
  return node.namedChildren.find((candidate) => candidate.type === type) ?? null;
}

function namedDescendants(node, types, results = []) {
  if (types.has(node.type)) results.push(node);
  for (const child of node.namedChildren) namedDescendants(child, types, results);
  return results;
}

function firstNamedDescendant(node, types) {
  if (types.has(node.type)) return node;
  for (const child of node.namedChildren) {
    const found = firstNamedDescendant(child, types);
    if (found) return found;
  }
  return null;
}

function snippetFor(node) {
  return String(node.text ?? '').replace(/\s+/g, ' ').trim().slice(0, maxSnippetLength);
}

function spanFor(repo, path, symbol, node, metadata = {}) {
  return {
    repo,
    path,
    symbolKind: symbol.kind,
    symbolName: symbol.name,
    startLine: pointLine(node.startPosition),
    endLine: pointLine(node.endPosition),
    startByte: node.startIndex ?? 0,
    endByte: node.endIndex ?? 0,
    evidenceSnippet: snippetFor(node),
    parser: parserVersion,
    metadata
  };
}

function withLineOffset(node, offset) {
  return {
    type: node.type,
    text: node.text,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startPosition: { ...node.startPosition, row: node.startPosition.row + offset },
    endPosition: { ...node.endPosition, row: node.endPosition.row + offset }
  };
}

function importRecord(repo, path, sourceModule, importedName, localName, importKind, line, metadata = {}) {
  return {
    repo,
    path,
    sourceModule,
    importedName,
    localName,
    importKind,
    line,
    parser: parserVersion,
    metadata
  };
}

function symbolRecord(repo, kind, name, path, node, tags = [], metadata = {}) {
  return {
    repo,
    kind,
    name,
    line: pointLine(node.startPosition),
    signature: snippetFor(node),
    tags,
    metadata: {
      ...metadata,
      parser: parserVersion
    }
  };
}

function relationshipRecord(sourceKind, sourceName, sourcePath, relationshipKind, targetKind, targetName, targetPath = '', metadata = {}) {
  return {
    source_kind: sourceKind,
    source_name: sourceName,
    source_path: sourcePath,
    relationship_kind: relationshipKind,
    target_kind: targetKind,
    target_name: targetName,
    target_path: targetPath,
    metadata: {
      ...metadata,
      parser: parserVersion
    }
  };
}

function phpClassName(node) {
  return childText(node, 'name');
}

function collectPhp(repo, path, tree) {
  const symbols = [];
  const relationships = [];
  const imports = [];
  const spans = [];
  const root = tree.rootNode;

  for (const node of namedDescendants(root, new Set(['namespace_use_declaration']))) {
    for (const qualified of namedDescendants(node, new Set(['qualified_name']))) {
      const sourceModule = qualified.text;
      const importedName = sourceModule.split('\\').pop() ?? sourceModule;
      imports.push(importRecord(repo, path, sourceModule, importedName, importedName, 'php_use', pointLine(node.startPosition)));
    }
  }

  const classNodes = namedDescendants(root, new Set(['class_declaration', 'trait_declaration', 'interface_declaration']));
  for (const classNode of classNodes) {
    const className = phpClassName(classNode);
    if (!className) continue;
    const classSymbol = symbolRecord(repo, 'php_class', className, path, classNode, [repo, 'php', 'class'], {
      declaration_type: classNode.type
    });
    symbols.push(classSymbol);
    spans.push(spanFor(repo, path, classSymbol, classNode, { declaration_type: classNode.type }));

    for (const methodNode of namedDescendants(classNode, new Set(['method_declaration']))) {
      const methodName = childText(methodNode, 'name');
      if (!methodName) continue;
      const methodSymbol = symbolRecord(repo, 'php_method', `${className}::${methodName}`, path, methodNode, [repo, 'php', 'method'], {
        class_name: className,
        method: methodName,
        visibility: childByType(methodNode, 'visibility_modifier')?.text ?? ''
      });
      symbols.push(methodSymbol);
      spans.push(spanFor(repo, path, methodSymbol, methodNode, { class_name: className, method: methodName }));
      relationships.push(relationshipRecord('php_class', className, path, 'declares_method', 'php_method', methodSymbol.name, path));

      if (/\$this->authorize\s*\(/.test(methodNode.text)) {
        relationships.push(relationshipRecord('php_method', methodSymbol.name, path, 'uses_authorization', 'policy_ability', '$this->authorize'));
      }
      for (const match of methodNode.text.matchAll(/\bnew\s+([A-Za-z0-9_]+Resource)\b/g)) {
        relationships.push(relationshipRecord('php_method', methodSymbol.name, path, 'returns_resource', 'resource', match[1]));
      }
    }
  }

  return { symbols, relationships, imports, spans };
}

function stringLiteralValue(node) {
  const fragment = firstNamedDescendant(node, new Set(['string_fragment']));
  if (fragment) return fragment.text;
  return node.text.replace(/^['"`]|['"`]$/g, '');
}

function collectJsTs(repo, path, tree, sourceText, options = {}) {
  const symbols = [];
  const relationships = [];
  const imports = [];
  const spans = [];
  const root = tree.rootNode;
  const lineOffset = Number(options.lineOffset ?? 0);

  for (const node of namedDescendants(root, new Set(['import_statement']))) {
    const sourceNode = childByType(node, 'string');
    const sourceModule = sourceNode ? stringLiteralValue(sourceNode) : '';
    if (!sourceModule) continue;
    const names = namedDescendants(node, new Set(['import_specifier', 'identifier']))
      .map((candidate) => candidate.text)
      .filter((value) => value && !value.includes('/') && value !== sourceModule);
    if (!names.length) {
      imports.push(importRecord(repo, path, sourceModule, '', '', 'module', pointLine(node.startPosition) + lineOffset));
      continue;
    }
    for (const name of [...new Set(names)]) {
      imports.push(importRecord(repo, path, sourceModule, name, name, 'esm', pointLine(node.startPosition) + lineOffset));
      const targetKind = sourceModule.includes('/stores/') || sourceModule.includes('stores/') ? 'store'
        : sourceModule.includes('/services/api') || sourceModule.includes('services/api') ? 'service'
          : sourceModule.includes('/components/') || sourceModule.includes('components/') ? 'component'
            : 'module';
      relationships.push(relationshipRecord('file', path, path, 'imports', targetKind, name, sourceModule));
    }
  }

  for (const node of namedDescendants(root, new Set(['function_declaration']))) {
    const name = childText(node, 'identifier') || childText(node, 'property_identifier');
    if (!name) continue;
    const adjustedNode = withLineOffset(node, lineOffset);
    const symbol = symbolRecord(repo, 'ts_function', name, path, adjustedNode, [repo, 'typescript', 'function']);
    symbols.push(symbol);
    spans.push(spanFor(repo, path, symbol, adjustedNode));
  }

  for (const node of namedDescendants(root, new Set(['variable_declarator']))) {
    const nameNode = childByType(node, 'identifier');
    if (!nameNode) continue;
    const name = nameNode.text;
    const adjustedNode = withLineOffset(node, lineOffset);
    const text = node.text;
    if (/defineStore\s*\(/.test(text)) {
      const id = text.match(/defineStore\s*\(\s*['"]([^'"]+)['"]/)?.[1] ?? name;
      const symbol = symbolRecord(repo, 'store', id, path, adjustedNode, [repo, 'typescript', 'pinia', 'store'], {
        local_name: name
      });
      symbols.push(symbol);
      spans.push(spanFor(repo, path, symbol, adjustedNode, { local_name: name }));
      continue;
    }
    if (/=>\s*|function\s*\(|async\s*\(/.test(text)) {
      const symbol = symbolRecord(repo, 'ts_function', name, path, adjustedNode, [repo, 'typescript', 'function'], {
        declaration: 'variable_declarator'
      });
      symbols.push(symbol);
      spans.push(spanFor(repo, path, symbol, adjustedNode));
    }
  }

  for (const match of sourceText.matchAll(/\b(use[A-Z][A-Za-z0-9]+Store)\s*\(/g)) {
    relationships.push(relationshipRecord('file', path, path, 'uses_store', 'store_factory', match[1], '', {
      line: sourceText.slice(0, match.index).split(/\r?\n/).length + lineOffset
    }));
  }

  for (const match of sourceText.matchAll(/\b([A-Za-z0-9_]+Service)\.([A-Za-z0-9_]+)\s*\(/g)) {
    relationships.push(relationshipRecord('file', path, path, 'calls_service_method', 'service_method', `${match[1]}.${match[2]}`, '', {
      line: sourceText.slice(0, match.index).split(/\r?\n/).length + lineOffset
    }));
  }

  return { symbols, relationships, imports, spans };
}

function scriptBlocks(content) {
  const blocks = [];
  const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const before = content.slice(0, match.index);
    blocks.push({
      content: match[1],
      lineOffset: before.split(/\r?\n/).length - 1
    });
  }
  return blocks;
}

function collectVueTemplate(repo, path, content) {
  const symbols = [];
  const relationships = [];
  const imports = [];
  const spans = [];
  const componentNames = new Set();
  const tagRegex = /<\/?([A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)?)\b/g;
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    componentNames.add(match[1]);
    relationships.push(relationshipRecord('vue_page', path, path, 'uses_component', 'component', match[1], '', {
      line: content.slice(0, match.index).split(/\r?\n/).length,
      parser_fallback: 'template-tag-scan'
    }));
  }
  for (const componentName of componentNames) {
    imports.push(importRecord(repo, path, '', componentName, componentName, 'vue_template_component', null, {
      parser_fallback: 'template-tag-scan'
    }));
  }
  return { symbols, relationships, imports, spans };
}

function mergeFacts(...facts) {
  return facts.reduce((merged, fact) => ({
    symbols: [...merged.symbols, ...(fact.symbols ?? [])],
    relationships: [...merged.relationships, ...(fact.relationships ?? [])],
    imports: [...merged.imports, ...(fact.imports ?? [])],
    spans: [...merged.spans, ...(fact.spans ?? [])]
  }), { symbols: [], relationships: [], imports: [], spans: [] });
}

export function extractTreeSitterFacts(path, content, context) {
  const language = languageForPath(path);
  const repo = context.repo;
  const relativePath = context.repoRelative(path);
  const file = {
    repo,
    path: relativePath,
    language,
    parser: parserVersion,
    parserStatus: language ? 'parsed' : 'not_applicable',
    sizeBytes: Buffer.byteLength(content),
    lineCount: lineCount(content),
    parseErrorCount: 0,
    metadata: {}
  };

  if (!language) return { file, symbols: [], relationships: [], imports: [], spans: [] };

  try {
    if (language === 'php') {
      const parser = parserFor('php');
      const tree = parser.parse(content);
      file.parseErrorCount = Number(tree.rootNode.hasError);
      return { file, ...collectPhp(repo, relativePath, tree) };
    }

    if (language === 'js' || language === 'ts' || language === 'tsx') {
      const parser = parserFor(language);
      const tree = parser.parse(content);
      file.parseErrorCount = Number(tree.rootNode.hasError);
      return { file, ...collectJsTs(repo, relativePath, tree, content) };
    }

    if (language === 'vue') {
      const parser = parserFor('ts');
      const facts = [];
      for (const block of scriptBlocks(content)) {
        const tree = parser.parse(block.content);
        file.parseErrorCount += Number(tree.rootNode.hasError);
        facts.push(collectJsTs(repo, relativePath, tree, block.content, { lineOffset: block.lineOffset }));
      }
      facts.push(collectVueTemplate(repo, relativePath, content));
      file.metadata = { vue_script_blocks: facts.length - 1 };
      return { file, ...mergeFacts(...facts) };
    }
  } catch {
    file.parserStatus = 'failed';
    file.parseErrorCount = 1;
    file.metadata = { failure_code: 'tree-sitter-analysis-failed' };
    return { file, symbols: [], relationships: [], imports: [], spans: [] };
  }

  return { file, symbols: [], relationships: [], imports: [], spans: [] };
}

export function parseStoredJson(value, fallback) {
  return parseJson(value, fallback);
}
