import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const defaultPackRoot = resolve(moduleDir, '../packs');

function findPackFiles(root) {
  if (!existsSync(root)) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) found.push(...findPackFiles(path));
    if (entry.isFile() && entry.name === 'pack.yaml') found.push(path);
  }
  return found;
}

export function listPacks(root = defaultPackRoot) {
  return findPackFiles(root).map((path) => {
    const pack = YAML.parse(readFileSync(path, 'utf8'));
    return { ...pack, path };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function projectPackRoots(projectRoot, options = {}) {
  return [
    defaultPackRoot,
    resolve(options.home ?? homedir(), '.ewai/packs'),
    resolve(projectRoot, '.ewai-pipeline/packs')
  ];
}

export function listProjectPacks(projectRoot, options = {}) {
  const packs = (options.roots ?? projectPackRoots(projectRoot, options)).flatMap((root) => listPacks(root));
  const byId = new Map();
  for (const pack of packs) {
    if (byId.has(pack.id)) throw new Error(`Duplicate EWAI pack id across installed roots: ${pack.id}`);
    byId.set(pack.id, pack);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
