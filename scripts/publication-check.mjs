import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rules = [
  ['personal-path', /\/(?:Users|home)\/(?!you(?:\/|\b)|example(?:\/|\b)|username(?:\/|\b)|user(?:\/|\b))[^\s/"'`<>]+\//],
  ['internal-workspace', /(?:BusinessOps\/|\.claude\/projects\/|EngineeringWithAI\/Content\/Companion)/],
  ['development-endpoint', /\b(?:api|our)\.dev\.backstory\.is\b/i],
  ['internal-provenance', /\b(?:Added|Originally generated|Created from lessons|introduced|Last index refresh)\b[^\n]{0,140}\b20\d{2}-\d{2}-\d{2}\b/i],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['stripe-secret', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/],
  ['google-key', /\bAIza[A-Za-z0-9_-]{30,}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{30,}\b/],
  ['telegram-token', /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/],
  ['authenticated-url', /https?:\/\/[^\s/]+:[^\s/@]+@/],
];

function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !isAbsolute(path)
    && !path.includes('\\') && !/[\x00-\x1f]/.test(path)
    && !path.split('/').some(part => part === '..' || part === '.' || part === '');
}

function privateFile(path) {
  if (/^\.ewai-pipeline\//.test(path)) return path !== '.ewai-pipeline/.gitignore';
  if (/^(?:SPECS\/|src\/migration\/|packs\/personas\/premium\/)/.test(path)) return true;
  if (/^config\/.*(?:source-manifest|migration-map|operation-parity)\.(?:json|ya?ml)$/.test(path)) return true;
  if (/(?:^|\/)(?:\.env(?:\..+)?|\.npmrc|\.netrc|id_rsa|id_ed25519)$/.test(path)) {
    return !/(?:^|\/)\.env\.(?:example|sample|template)$/.test(path);
  }
  return /\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|sql|har|log|zip|tgz)$/i.test(path);
}

export function publicationIssues(path, content) {
  if (!safePath(path)) return [{ file: '[unsafe path]', line: 0, category: 'unsafe-path' }];
  const findings = privateFile(path) ? [{ file: path, line: 0, category: 'private-file' }] : [];
  for (const [index, line] of String(content).split('\n').entries()) {
    for (const [category, expression] of rules) {
      if (expression.test(line)) findings.push({ file: path, line: index + 1, category });
    }
  }
  return findings;
}

export function scanPublicationFiles(root, paths) {
  const findings = [];
  for (const path of [...new Set(paths)].sort()) {
    if (!safePath(path)) {
      findings.push(...publicationIssues(path, ''));
      continue;
    }
    const absolute = resolve(root, path);
    if (relative(resolve(root), absolute).startsWith('..')) {
      findings.push({ file: '[unsafe path]', line: 0, category: 'unsafe-path' });
      continue;
    }
    try {
      const components = path.split('/');
      let candidate = resolve(root);
      let linked = false;
      for (const component of components) {
        candidate = resolve(candidate, component);
        if (lstatSync(candidate).isSymbolicLink()) { linked = true; break; }
      }
      if (linked) {
        findings.push({ file: path, line: 0, category: 'symlink' });
        continue;
      }
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) {
        findings.push({ file: path, line: 0, category: 'unscannable-file' });
        continue;
      }
      const pathIssues = publicationIssues(path, '');
      if (pathIssues.length) { findings.push(...pathIssues); continue; }
      findings.push(...publicationIssues(path, readFileSync(absolute).toString('utf8')));
    } catch (error) {
      findings.push({ file: path, line: 0, category: error.code === 'ENOENT' ? 'missing-file' : 'unreadable-file' });
    }
  }
  return findings;
}

function repositoryCandidates(root) {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).split('\0').filter(Boolean);
  return [...new Set(listed)].filter(path => {
    try { lstatSync(resolve(root, path)); return true; }
    catch (error) { return error.code !== 'ENOENT'; }
  });
}

export function checkPublication(root, { sourceOnly = false } = {}) {
  const source = repositoryCandidates(root);
  const findings = scanPublicationFiles(root, source);
  let packedFiles = 0;
  if (!sourceOnly) {
    const cache = mkdtempSync(resolve(tmpdir(), 'ewai-publication-cache-'));
    try {
      const result = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
        env: { ...process.env, npm_config_cache: cache, npm_config_update_notifier: 'false' },
      });
      const manifest = JSON.parse(result);
      if (!Array.isArray(manifest) || manifest.length !== 1 || !Array.isArray(manifest[0].files) || !manifest[0].files.length) {
        throw new Error('Invalid package manifest');
      }
      const paths = manifest[0].files.map(file => file.path);
      if (paths.some(path => typeof path !== 'string')) throw new Error('Invalid package path');
      packedFiles = paths.length;
      findings.push(...scanPublicationFiles(root, paths));
    } catch {
      findings.push({ file: 'package.json', line: 0, category: 'package-inspection-failed' });
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  }
  const unique = [...new Map(findings.map(finding => [JSON.stringify(finding), finding])).values()];
  return { status: unique.length ? 'fail' : 'pass', sourceFiles: source.length, packedFiles, findings: unique };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selected = process.argv.indexOf('--project');
  const root = selected < 0 ? resolve(dirname(fileURLToPath(import.meta.url)), '..') : resolve(process.argv[selected + 1] ?? '.');
  const quiet = process.argv.includes('--quiet');
  try {
    const result = checkPublication(root, { sourceOnly: process.argv.includes('--source-only') });
    if (!quiet || result.status !== 'pass') (quiet ? console.error : console.log)(JSON.stringify(result));
    process.exitCode = result.status === 'pass' ? 0 : 1;
  } catch {
    (quiet ? console.error : console.log)(JSON.stringify({ status: 'fail', findings: [{ file: '[repository]', line: 0, category: 'source-inspection-failed' }] }));
    process.exitCode = 1;
  }
}
