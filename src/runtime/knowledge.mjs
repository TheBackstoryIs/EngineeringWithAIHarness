import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { runtimePaths } from './paths.mjs';

const readableExtensions = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.json', '.csv']);
const maxDocumentBytes = 2 * 1024 * 1024;

function isWithin(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function specsBoundary(projectRoot) {
  const configured = runtimePaths(projectRoot).specsRoot;
  if (!existsSync(configured)) return null;
  return { configured, real: realpathSync(configured) };
}

function walk(boundary, directory = boundary.configured, parentPath = '') {
  const folders = [];
  const documents = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))) {
    if (entry.name.startsWith('.')) continue;
    const absolute = resolve(directory, entry.name);
    const logicalPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      const children = walk(boundary, absolute, logicalPath);
      if (children.documentCount) {
        folders.push({ type: 'folder', name: entry.name, path: logicalPath, children: children.nodes, documentCount: children.documentCount });
      }
      documents.push(...children.documents);
      continue;
    }
    if (!stats.isFile() || !readableExtensions.has(extname(entry.name).toLowerCase())) continue;
    const real = realpathSync(absolute);
    if (!isWithin(boundary.real, real)) continue;
    const document = {
      type: 'document',
      name: entry.name,
      path: logicalPath,
      extension: extname(entry.name).toLowerCase(),
      size: stats.size,
      updatedAt: stats.mtime.toISOString()
    };
    documents.push(document);
  }
  return {
    nodes: [...folders, ...documents.filter((document) => document.path.split('/').length === parentPath.split('/').filter(Boolean).length + 1)],
    documents,
    documentCount: documents.length
  };
}

export function listKnowledge(projectRoot, options = {}) {
  const boundary = specsBoundary(projectRoot);
  if (!boundary) return { root: 'SPECS', tree: [], documents: [], count: 0 };
  const result = walk(boundary);
  const query = String(options.query ?? '').trim().toLowerCase();
  const documents = query
    ? result.documents.filter((document) => `${document.name} ${document.path}`.toLowerCase().includes(query))
    : result.documents;
  return { root: 'SPECS', tree: result.nodes, documents, count: documents.length };
}

export function readKnowledgeDocument(projectRoot, documentPath) {
  const boundary = specsBoundary(projectRoot);
  if (!boundary) return null;
  const normalized = String(documentPath ?? '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '')) return null;
  const target = resolve(boundary.configured, normalized);
  if (!isWithin(boundary.configured, target) || !existsSync(target) || lstatSync(target).isSymbolicLink() || !statSync(target).isFile()) return null;
  const real = realpathSync(target);
  const extension = extname(real).toLowerCase();
  const stats = statSync(real);
  if (!isWithin(boundary.real, real) || !readableExtensions.has(extension) || stats.size > maxDocumentBytes) return null;
  return {
    name: normalized.split('/').at(-1),
    path: normalized,
    extension,
    size: stats.size,
    updatedAt: stats.mtime.toISOString(),
    content: readFileSync(real, 'utf8')
  };
}
