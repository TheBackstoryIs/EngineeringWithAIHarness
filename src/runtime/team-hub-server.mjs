import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ingestTeamHubEnvelope,
  openTeamHubDatabase,
  publishTeamHubResource,
  readTeamHubPortfolio,
  readTeamHubResourceCatalogue,
  readTeamHubResourcePackage,
  validateTeamHubDataRoot,
} from './team-hub-database.mjs';
import { TEAM_HUB_RESOURCE_LIMITS } from '../team-hub-resources.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultStaticRoot = resolve(moduleDirectory, '../../public/team-hub');
const DEFAULT_MAXIMUM_BODY_BYTES = 256 * 1024;

function loopback(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(String(host ?? '').toLowerCase());
}

function json(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function safeError(response, status, code, message) {
  json(response, status, { error: { code, message } });
}

function authorised(request, token) {
  if (!token) return false;
  const supplied = String(request.headers.authorization ?? '');
  const expected = `Bearer ${token}`;
  const left = createHash('sha256').update(supplied).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

async function readBody(request, maximumBytes) {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > maximumBytes) throw Object.assign(new Error('Request body exceeds the Team Hub limit.'), { status: 413, code: 'body-too-large' });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw Object.assign(new Error('Request body exceeds the Team Hub limit.'), { status: 413, code: 'body-too-large' });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400, code: 'invalid-json' }); }
}

function staticAsset(response, staticRoot, pathname) {
  const routes = new Map([
    ['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css'],
  ]);
  const name = routes.get(pathname);
  if (!name) return false;
  const path = resolve(staticRoot, name);
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  const body = readFileSync(path);
  const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[extname(path)] ?? 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type, 'content-length': body.length, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
  return true;
}

export async function createTeamHubHttpServer(options = {}) {
  const dataRoot = validateTeamHubDataRoot(options.dataRoot);
  const host = String(options.host ?? '127.0.0.1');
  if (!loopback(host) && options.allowNetwork !== true) throw new Error('A non-loopback Team Hub bind requires --allow-network.');
  const token = String(options.token ?? '');
  if (token.length < 16 || token.length > 1_024) throw new Error('Team Hub token must contain 16 to 1024 characters.');
  const publisherToken = String(options.publisherToken ?? '');
  if (publisherToken && (publisherToken.length < 16 || publisherToken.length > 1_024)) throw new Error('Team Hub publisher token must contain 16 to 1024 characters.');
  if (publisherToken && publisherToken === token) throw new Error('Team Hub reader and publisher tokens must be different.');
  const database = openTeamHubDatabase(dataRoot);
  const startedAt = options.startedAt ?? new Date().toISOString();
  const staticRoot = resolve(options.staticRoot ?? defaultStaticRoot);
  const maximumBodyBytes = Number(options.maximumBodyBytes ?? DEFAULT_MAXIMUM_BODY_BYTES);
  const maximumResourceBodyBytes = Number(options.maximumResourceBodyBytes ?? TEAM_HUB_RESOURCE_LIMITS.maximumPackageBytes);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      if (url.search) return safeError(response, 400, 'unexpected-query', 'This Team Hub route does not accept query parameters.');
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, { schema: 'ewai.team-hub-health/v1', status: 'running', pid: process.pid, startedAt, bind: loopback(host) ? 'loopback' : 'network', tls: false, publisherConfigured: Boolean(publisherToken) });
      }
      if (request.method === 'GET' && ['/','/index.html','/app.js','/styles.css'].includes(url.pathname)) {
        if (staticAsset(response, staticRoot, url.pathname)) return;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/resources') {
        if (!publisherToken) return safeError(response, 503, 'publisher-not-configured', 'Resource publication is not configured on this Team Hub.');
        if (!authorised(request, publisherToken)) return safeError(response, 401, 'unauthorised', 'Publisher authentication is required.');
        if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          return safeError(response, 415, 'unsupported-media-type', 'Resource publication requires application/json.');
        }
        const input = await readBody(request, maximumResourceBodyBytes);
        const receipt = publishTeamHubResource(database, input, { idempotencyKey: request.headers['idempotency-key'] });
        return json(response, receipt.replayed ? 200 : 202, receipt);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/resources') {
        if (!authorised(request, token) && !authorised(request, publisherToken)) return safeError(response, 401, 'unauthorised', 'Authentication is required.');
        return json(response, 200, readTeamHubResourceCatalogue(database));
      }
      const resourceRelease = url.pathname.match(/^\/api\/v1\/resources\/([^/]+)\/releases\/([^/]+)$/);
      if (request.method === 'GET' && resourceRelease) {
        if (!authorised(request, token) && !authorised(request, publisherToken)) return safeError(response, 401, 'unauthorised', 'Authentication is required.');
        let resourceId;
        let version;
        try { resourceId = decodeURIComponent(resourceRelease[1]); version = decodeURIComponent(resourceRelease[2]); }
        catch { return safeError(response, 400, 'invalid-resource-identity', 'Resource identity is invalid.'); }
        if (!/^org\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(resourceId) || !/^\d+\.\d+\.\d+$/.test(version)) {
          return safeError(response, 400, 'invalid-resource-identity', 'Resource identity is invalid.');
        }
        return json(response, 200, readTeamHubResourcePackage(database, resourceId, version));
      }
      if (url.pathname.startsWith('/api/v1/') && !authorised(request, token)) {
        return safeError(response, 401, 'unauthorised', 'Authentication is required.');
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/snapshots') {
        if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          return safeError(response, 415, 'unsupported-media-type', 'Snapshots require application/json.');
        }
        const input = await readBody(request, maximumBodyBytes);
        const receipt = ingestTeamHubEnvelope(database, input);
        return json(response, receipt.replayed ? 200 : 202, receipt);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/portfolio') {
        return json(response, 200, readTeamHubPortfolio(database));
      }
      return safeError(response, 404, 'not-found', 'Team Hub route not found.');
    } catch (error) {
      const status = Number(error.status ?? 400);
      return safeError(response, status >= 400 && status < 600 ? status : 400, error.code ?? 'invalid-request', status >= 500 ? 'Team Hub could not complete the request.' : String(error.message ?? 'Invalid request.').slice(0, 240));
    }
  });

  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(Number(options.port ?? 0), host, accept);
  });
  const address = server.address();
  const displayHost = host === '::1' ? '[::1]' : host;
  const url = `http://${displayHost}:${address.port}`;
  return {
    schema: 'ewai.team-hub-running-service/v1', url, host, port: address.port, startedAt,
    close: async () => {
      await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
      database.close();
    },
  };
}

function option(args, name, fallback = '') {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const tokenEnv = option(args, '--token-env');
  const token = process.env[tokenEnv] ?? '';
  const publisherTokenEnv = option(args, '--publisher-token-env');
  const publisherToken = publisherTokenEnv ? process.env[publisherTokenEnv] ?? '' : '';
  createTeamHubHttpServer({
    dataRoot: option(args, '--data'), host: option(args, '--host', '127.0.0.1'),
    port: Number(option(args, '--port', '0')), token, publisherToken, allowNetwork: args.includes('--allow-network'),
  }).then((running) => {
    const shutdown = async () => { await running.close(); process.exit(0); };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }).catch((error) => {
    process.stderr.write(`Team Hub failed to start: ${error.message}\n`);
    process.exit(1);
  });
}
