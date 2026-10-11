import { existsSync, readFileSync } from 'node:fs';
import { extname, posix, resolve } from 'node:path';

const extensions = ['.php', '.mjs', '.js', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.py', '.go', '.rb', '.java', '.kt', '.kts', '.cs', '.rs', '.scala', '.swift'];

// A specifier resolves only when this repository's layout or module map names a file.
// A bare dependency name is external. It is not evidence that nothing else references the file.
export function splitStoredPath(stored) {
  const value = String(stored ?? '');
  const index = value.indexOf(':');
  return index < 0 ? { repo: '', relative: value } : { repo: value.slice(0, index), relative: value.slice(index + 1) };
}

function readJson(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1');
    try {
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
}

function safeRelative(value) {
  const relative = String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!relative || relative.split('/').includes('..')) return '';
  return relative;
}

function withExtensions(relative) {
  const base = safeRelative(relative);
  if (!base) return [];
  if (extname(base)) return [base];
  return [
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => `${base}/index${extension}`)
  ];
}

function matchKnown(repoName, relatives, knownPaths) {
  for (const relative of relatives) {
    const stored = `${repoName}:${relative}`;
    if (knownPaths.has(stored)) return stored;
  }
  return '';
}

function psr4Maps(repoRoot) {
  const parsed = readJson(resolve(repoRoot, 'composer.json'));
  if (!parsed) return [];
  const maps = [parsed.autoload?.['psr-4'], parsed['autoload-dev']?.['psr-4']];
  const prefixes = [];
  for (const map of maps) {
    if (!map || typeof map !== 'object') continue;
    for (const [prefix, directories] of Object.entries(map)) {
      for (const directory of Array.isArray(directories) ? directories : [directories]) {
        if (typeof directory !== 'string') continue;
        prefixes.push({
          prefix: prefix.replace(/^\\/, '').replace(/\\+$/, ''),
          directory: safeRelative(directory.replace(/\/$/, ''))
        });
      }
    }
  }
  return prefixes.sort((left, right) => right.prefix.length - left.prefix.length);
}

function pathMaps(repoRoot) {
  const maps = [];
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const options = readJson(resolve(repoRoot, name))?.compilerOptions ?? {};
    const baseUrl = safeRelative(options.baseUrl || '.');
    const paths = options.paths;
    if (!paths || typeof paths !== 'object') continue;
    for (const [pattern, targets] of Object.entries(paths)) {
      for (const target of Array.isArray(targets) ? targets : [targets]) {
        if (typeof target !== 'string') continue;
        const joined = posix.join(baseUrl === '.' ? '' : baseUrl, target).replace(/^\//, '');
        maps.push({ pattern, target: safeRelative(joined) || safeRelative(target) });
      }
    }
  }
  const imports = readJson(resolve(repoRoot, 'package.json'))?.imports;
  if (imports && typeof imports === 'object') {
    for (const [pattern, target] of Object.entries(imports)) {
      const value = typeof target === 'string' ? target : target?.default;
      if (typeof value === 'string') maps.push({ pattern, target: safeRelative(value) });
    }
  }
  return maps;
}

function applyPattern(pattern, target, specifier) {
  if (pattern.endsWith('/*') && specifier.startsWith(pattern.slice(0, -1))) {
    return target.replace(/\*$/, specifier.slice(pattern.length - 1));
  }
  if (pattern === specifier) return target.replace(/\*$/, '');
  return '';
}

function goModule(repoRoot) {
  const path = resolve(repoRoot, 'go.mod');
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').match(/^module\s+(\S+)/m)?.[1] ?? '';
}

function looksInternal(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('~/') || specifier.startsWith('@/') || specifier.includes('\\');
}

export function resolveSpecifier({ importer, sourceModule, knownPaths, repoRoot, repoName }) {
  const specifier = String(sourceModule ?? '').trim().replace(/^\\/, '');
  const repo = repoName || splitStoredPath(importer).repo;
  if (!specifier || !repo) return { storedPath: '', basis: 'unresolved' };

  if (specifier.startsWith('.')) {
    const base = posix.normalize(posix.join(posix.dirname(splitStoredPath(importer).relative), specifier));
    const stored = matchKnown(repo, withExtensions(base), knownPaths);
    return stored ? { storedPath: stored, basis: 'relative' } : { storedPath: '', basis: 'unresolved' };
  }

  if (repoRoot) {
    const namespaced = specifier.replace(/\//g, '\\');
    for (const entry of psr4Maps(repoRoot)) {
      if (namespaced !== entry.prefix && !namespaced.startsWith(`${entry.prefix}\\`)) continue;
      const rest = namespaced.slice(entry.prefix.length).replace(/^\\/, '').replaceAll('\\', '/');
      const relative = entry.directory ? `${entry.directory}/${rest}` : rest;
      const stored = matchKnown(repo, withExtensions(relative), knownPaths);
      return stored ? { storedPath: stored, basis: 'module-map' } : { storedPath: '', basis: 'unresolved' };
    }
    for (const entry of pathMaps(repoRoot)) {
      const mapped = applyPattern(entry.pattern, entry.target, specifier);
      if (!mapped) continue;
      const stored = matchKnown(repo, withExtensions(mapped), knownPaths);
      return stored ? { storedPath: stored, basis: 'module-map' } : { storedPath: '', basis: 'unresolved' };
    }
    const moduleName = goModule(repoRoot);
    if (moduleName && (specifier === moduleName || specifier.startsWith(`${moduleName}/`))) {
      const rest = specifier.slice(moduleName.length).replace(/^\//, '');
      const stored = matchKnown(repo, withExtensions(rest), knownPaths);
      return stored ? { storedPath: stored, basis: 'module-map' } : { storedPath: '', basis: 'unresolved' };
    }
  }

  if (specifier.startsWith('~/') || specifier.startsWith('@/')) {
    const stored = matchKnown(repo, withExtensions(specifier.slice(2)), knownPaths);
    return stored ? { storedPath: stored, basis: 'alias' } : { storedPath: '', basis: 'unresolved' };
  }

  if (specifier.includes('.') && !specifier.includes('/') && !specifier.includes('\\')) {
    const stored = matchKnown(repo, withExtensions(specifier.replaceAll('.', '/')), knownPaths);
    if (stored) return { storedPath: stored, basis: 'dotted-path' };
    const rootSegment = specifier.split('.')[0];
    if ([...knownPaths].some((path) => path.startsWith(`${repo}:${rootSegment}/`))) {
      return { storedPath: '', basis: 'unresolved' };
    }
  }

  return looksInternal(specifier) ? { storedPath: '', basis: 'unresolved' } : { storedPath: '', basis: 'external' };
}

export function resolveNamedTarget({ sourcePath, targetName, targetKind, knownPaths, symbols, repoRoots }) {
  if (targetKind === 'route') return { storedPath: '', basis: 'route-label' };
  const { repo } = splitStoredPath(sourcePath);
  const className = String(targetName ?? '').split('::')[0];
  if (className.includes('\\') || className.includes('/') || className.startsWith('~/') || className.startsWith('@/')) {
    const resolved = resolveSpecifier({
      importer: sourcePath,
      sourceModule: className,
      knownPaths,
      repoRoot: repoRoots?.[repo] ?? '',
      repoName: repo
    });
    if (resolved.storedPath || resolved.basis === 'unresolved') return resolved;
  }
  const matches = symbols.filter((symbol) => symbol.symbol_name === targetName || symbol.symbol_name === className);
  const paths = [...new Set(matches.map((symbol) => symbol.path))];
  if (paths.length === 1) return { storedPath: paths[0], basis: 'unique-symbol' };
  if (targetKind === 'symbol' || String(targetName).includes('::')) return { storedPath: '', basis: 'unresolved' };
  return { storedPath: '', basis: 'external' };
}
