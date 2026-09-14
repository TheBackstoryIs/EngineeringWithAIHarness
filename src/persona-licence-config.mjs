import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export function personaLicencePath(home = homedir()) {
  return resolve(home, '.ewai/entitlements/conversational-coding.json');
}

export function personaAccessDenialPath(home = homedir()) {
  return resolve(home, '.ewai/entitlements/persona-access-denial.json');
}

export function readPersonaAccessDenial(home = homedir()) {
  return privateJson(home, personaAccessDenialPath(home));
}

// Shared by EWAI and future Monomyth clients: identity is not a hostname hash.
export function personaInstallationPath(home = homedir()) {
  return resolve(home, '.config/conversational-coding/installation.json');
}

export function guardPersonaPath(home, path) {
  const root = resolve(home), target = resolve(path), rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !lstatSync(root).isDirectory()) throw new Error('Unsafe persona filesystem path');
  let current = root;
  for (const part of rel.split(/[\\/]/)) {
    current = resolve(current, part);
    if (!existsSync(current)) {
      // existsSync follows links; lstat also detects a dangling link.
      try { lstatSync(current); throw new Error('Unsafe symbolic persona path'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1)) {
      throw new Error('Unsafe symbolic or shared persona path');
    }
  }
  return target;
}

function privateJson(home, path) {
  try { lstatSync(resolve(home)); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  guardPersonaPath(home, path);
  if (!existsSync(path)) return null;
  const s = lstatSync(path);
  if (!s.isFile() || s.size > 16 * 1024 || (process.platform !== 'win32' && (s.mode & 0o077))) throw new Error('Unsafe private persona config');
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('Private persona config is invalid; repair it before continuing'); }
}

export function writePrivatePersonaJson(home, path, value) {
  guardPersonaPath(home, path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

export function readPersonaLicence(home = homedir()) {
  const data = privateJson(home, personaLicencePath(home));
  if (!data) return null;
  if (data.schema !== 'ewai.persona-licence/v1' || typeof data.licenceKey !== 'string' || !data.licenceKey
    || !/^[a-f0-9]{64}$/.test(data.installationSecret) || typeof data.activationToken !== 'string' || !data.activationToken
    || typeof data.activationId !== 'string' || !data.activationId || typeof data.server !== 'string') {
    throw new Error('Private persona config is invalid; configure the licence again');
  }
  return data;
}

export function personaInstallationSecret(home = homedir()) {
  const path = personaInstallationPath(home), data = privateJson(home, path);
  if (data) {
    if (data.schema !== 'cce.installation/v1' || !/^[a-f0-9]{64}$/.test(data.installationSecret)) throw new Error('Private machine identity is invalid');
    return data.installationSecret;
  }
  const secret = randomBytes(32).toString('hex');
  // An exclusive file prevents two products replacing the identity concurrently.
  guardPersonaPath(home, path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); chmodSync(dirname(path), 0o700);
  try { writeFileSync(path, JSON.stringify({ schema: 'cce.installation/v1', installationSecret: secret }) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code === 'EEXIST') return personaInstallationSecret(home); throw e; }
  return secret;
}

export async function withPersonaMutationLock(home, operation) {
  const folder = guardPersonaPath(home, resolve(home, '.ewai/packs'));
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const lock = guardPersonaPath(home, resolve(folder, '.persona-pack.lock'));
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('Another persona-pack operation is running; retry after it finishes'); throw e; }
  try { return await operation(); }
  finally { guardPersonaPath(home, lock); rmSync(lock, { recursive: true }); }
}
