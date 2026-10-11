// Recognised route conventions. The index stores handles_route for whichever convention matches.
// A file that matches none still contributes imports, symbols, and history.

const routeLimit = 40;

function relationship(sourceName, metadata) {
  return {
    source_kind: 'file',
    source_name: sourceName,
    source_path: sourceName,
    relationship_kind: 'handles_route',
    target_kind: metadata.handler ? 'symbol' : 'route',
    target_name: metadata.handler || `${metadata.verb} ${metadata.uri}`,
    target_path: '',
    metadata
  };
}

function normalUri(uri) {
  const value = String(uri ?? '').trim();
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function pageUri(stem) {
  const parts = String(stem ?? '').split('/').flatMap((part) => {
    if (!part || part === 'index') return [];
    const catchAll = part.match(/^\[\.\.\.(.+)\]$/);
    if (catchAll) return [`*${catchAll[1]}`];
    const optional = part.match(/^\[\[(.+)\]\]$/);
    if (optional) return [`:${optional[1]}?`];
    const dynamic = part.match(/^\[(.+)\]$/);
    if (dynamic) return [`:${dynamic[1]}`];
    return [part];
  });
  return `/${parts.join('/')}`.replace(/\/+/g, '/') || '/';
}

function fileBasedRoute(relativePath) {
  const path = relativePath.replaceAll('\\', '/');
  const page = path.match(/(?:^|\/)pages\/(.+)\.(?:vue|js|jsx|ts|tsx|svelte|md|mdx)$/);
  if (page) return { verb: 'GET', uri: pageUri(page[1]), convention: 'file-based-page' };
  const appPage = path.match(/(?:^|\/)app\/(.+)\/page\.(?:vue|js|jsx|ts|tsx)$/);
  if (appPage) return { verb: 'GET', uri: pageUri(appPage[1]), convention: 'file-based-page' };
  const appRoute = path.match(/(?:^|\/)app\/(.+)\/route\.(?:js|ts|mjs)$/);
  if (appRoute) return { verb: 'ANY', uri: pageUri(appRoute[1]), convention: 'file-based-route' };
  const api = path.match(/(?:^|\/)server\/api\/(.+)\.(?:js|ts|mjs)$/);
  if (api) return serverRoute(api[1], '/api');
  const server = path.match(/(?:^|\/)server\/routes\/(.+)\.(?:js|ts|mjs)$/);
  if (server) return serverRoute(server[1], '');
  return null;
}

function serverRoute(stem, prefix) {
  const method = stem.match(/\.(get|post|put|patch|delete)$/i);
  const bare = method ? stem.slice(0, -method[0].length) : stem;
  return {
    verb: method ? method[1].toUpperCase() : 'ANY',
    uri: `${prefix}${pageUri(bare)}`.replace(/\/+/g, '/') || '/',
    convention: 'file-based-server-route'
  };
}

function phpImports(content) {
  const aliases = new Map();
  for (const match of content.matchAll(/\buse\s+([^;]+);/g)) {
    const [imported, alias] = match[1].trim().split(/\s+as\s+/);
    const qualified = imported.replace(/^\\/, '').trim();
    const name = (alias ?? qualified.split('\\').pop() ?? '').trim();
    if (name) aliases.set(name, qualified);
  }
  return aliases;
}

function qualifyPhp(name, aliases) {
  const bare = String(name ?? '').replace(/^\\/, '');
  if (!bare) return '';
  if (bare.includes('\\')) return bare;
  return aliases.get(bare) ?? bare;
}

function laravelRoutes(relativePath, content) {
  if (!relativePath.endsWith('.php') || !content.includes('Route::')) return [];
  const aliases = phpImports(content);
  const found = [];
  for (const match of content.matchAll(/Route::(get|post|put|patch|delete|any|match)\s*\(\s*(['"])([^'"]+)\2\s*,\s*([^)]+)\)/g)) {
    const action = match[4];
    const classMatch = action.match(/([A-Za-z0-9_\\]+)::class/);
    const stringMatch = action.match(/['"]([A-Za-z0-9_\\]+)@([A-Za-z0-9_]+)['"]/);
    const methodLiteral = action.match(/,\s*['"]([A-Za-z0-9_]+)['"]/);
    let handler = '';
    if (stringMatch) handler = `${qualifyPhp(stringMatch[1], aliases)}::${stringMatch[2]}`;
    else if (classMatch) handler = `${qualifyPhp(classMatch[1], aliases)}::${methodLiteral?.[1] ?? '__invoke'}`;
    found.push(relationship(relativePath, {
      convention: 'route-registration',
      verb: ['ROUTE', 'REQUEST', 'ALL', 'MATCH'].includes(match[1].toUpperCase()) ? 'ANY' : match[1].toUpperCase(),
      uri: normalUri(match[3]),
      handler
    }));
  }
  for (const match of content.matchAll(/Route::(resource|apiResource)\s*\(\s*(['"])([^'"]+)\2\s*,\s*([A-Za-z0-9_\\]+)::class/g)) {
    found.push(relationship(relativePath, {
      convention: 'route-registration',
      verb: 'ANY',
      uri: normalUri(match[3]),
      handler: qualifyPhp(match[4], aliases)
    }));
  }
  return found;
}

function pushCalls(found, relativePath, content, pattern, convention, verbGroup, uriGroup) {
  for (const match of content.matchAll(pattern)) {
    const verb = verbGroup == null ? 'ANY' : String(match[verbGroup] || 'ANY').toUpperCase();
    found.push(relationship(relativePath, {
      convention,
      verb: ['ROUTE', 'REQUEST', 'ALL'].includes(verb) ? 'ANY' : verb,
      uri: normalUri(match[uriGroup]),
      handler: ''
    }));
  }
}

export function routeRelationships(relativePath, content) {
  const path = String(relativePath ?? '').replaceAll('\\', '/');
  const source = String(content ?? '');
  if (!path || !source) return [];
  const found = [];
  const fileRoute = fileBasedRoute(path);
  if (fileRoute) found.push(relationship(path, { ...fileRoute, handler: '' }));
  found.push(...laravelRoutes(path, source));
  if (/\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts)$/.test(path)) {
    pushCalls(found, path, source, /\b(?:app|router|fastify|server)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/g, 'http-call-registration', 1, 2);
  }
  if (path.endsWith('.py')) {
    pushCalls(found, path, source, /@(?:\w+\.)?(route|get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g, 'decorator-route', 1, 2);
  }
  if (path.endsWith('.go')) {
    pushCalls(found, path, source, /HandleFunc\(\s*"([^"]+)"/g, 'handler-registration', null, 1);
  }
  if (/\.(?:java|kt|kts)$/.test(path)) {
    pushCalls(found, path, source, /@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g, 'mapping-annotation', 1, 2);
  }
  if (path.endsWith('.cs')) {
    pushCalls(found, path, source, /\[Http(Get|Post|Put|Patch|Delete)(?:\(\s*"([^"]*)"\s*\))?\]/g, 'mapping-annotation', 1, 2);
  }
  if (path.endsWith('config/routes.rb')) {
    pushCalls(found, path, source, /\b(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/g, 'route-draw', 1, 2);
  }
  return found.slice(0, routeLimit);
}
