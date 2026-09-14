import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, resolve } from 'node:path';
import YAML from 'yaml';
import { projectPaths } from './paths.mjs';

const personaSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const personaRefPattern = /^[a-z0-9][a-z0-9._-]*$/;

export function validatePersonaRef(value) {
  const reference = String(value ?? '').trim();
  if (!personaRefPattern.test(reference)) throw new Error(`Invalid persona reference: ${reference}`);
  return reference;
}

function findMarkdown(root) {
  if (!existsSync(root)) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) found.push(...findMarkdown(path));
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') found.push(path);
  }
  return found;
}

export function readPersona(path) {
  const content = readFileSync(path, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let metadata = {};
  let parseStatus = 'none';
  if (match) {
    try {
      metadata = YAML.parse(match[1]) ?? {};
      parseStatus = 'parsed';
    } catch {
      const legacyName = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
      metadata = legacyName ? { name: legacyName } : {};
      parseStatus = 'legacy-fallback';
    }
  }
  const name = metadata?.name || basename(path, extname(path));
  const id = validatePersonaRef(metadata?.id || name);
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^#\s+.+\r?\n+/, '');
  const summary = body.split(/\r?\n\s*\r?\n/).find((paragraph) => paragraph.trim() && !paragraph.trim().startsWith('#')) ?? '';
  return {
    id,
    name,
    description: metadata?.description || summary.replace(/[`*_>#\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240),
    category: metadata?.category || '',
    pack: metadata?.pack || '',
    tier: metadata?.tier || '',
    version: metadata?.version || '',
    tags: metadata?.tags || [],
    capabilities: metadata?.capabilities || [],
    parseStatus,
    path
  };
}

export function listPersonas(roots, query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  const unique = new Map();

  for (const root of roots) {
    for (const path of findMarkdown(root)) {
      let persona;
      try {
        persona = readPersona(path);
      } catch {
        continue;
      }
      const key = `${persona.id}:${path}`;
      if (!normalizedQuery || JSON.stringify(persona).toLowerCase().includes(normalizedQuery)) {
        unique.set(key, persona);
      }
    }
  }

  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function indexPersonas(roots, query = '') {
  return listPersonas(roots, query).map((persona) => ({
    id: persona.id,
    name: persona.name,
    description: persona.description,
    category: persona.category,
    tier: persona.tier,
    tags: persona.tags,
    capabilities: persona.capabilities,
    path: persona.path
  }));
}

export function personalPersonaRoot(home = homedir()) {
  return resolve(home, '.ewai/personas');
}

export function projectPersonaRoot(projectRoot) {
  if (!projectRoot) throw new Error('A project root is required for project personas');
  return resolve(projectPaths(projectRoot).personaRoot, 'project');
}

export function personaLibraryRoot(scope, options = {}) {
  if (scope === 'personal') return personalPersonaRoot(options.home);
  if (scope === 'project') return projectPersonaRoot(options.projectRoot);
  throw new Error(`Unsupported persona scope: ${scope}`);
}

function personaName(slug) {
  return slug
    .split('-')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function personaTemplate({ scope, slug, name, category }) {
  const metadata = {
    schema: 'ewai.persona/v1',
    id: `${scope}.${slug}`,
    name,
    version: '0.1.0',
    description: `A ${scope} persona for ${name}.`,
    category,
    pack: `ewai.personas.${scope}`,
    tier: scope,
    tags: [],
    capabilities: []
  };

  return `---\n${YAML.stringify(metadata, { lineWidth: 0 }).trim()}\n---\n\n# ${name}\n\n## Mission\n\nDescribe the outcome this persona cares about and the perspective it brings.\n\n## Operating stance\n\n- Describe how this persona approaches decisions.\n- Record the standards, evidence, or experience it should use.\n- Make uncertainty and assumptions explicit.\n\n## Questions to keep asking\n\n- What would this persona need to know?\n- What risks or opportunities would it notice?\n- What evidence would satisfy it?\n\n## Boundaries\n\n- This persona advises; it does not replace real stakeholders or grant authority.\n- Evidence from real people takes priority over simulated feedback.\n`;
}

export function createPersona(options = {}) {
  const scope = options.scope || 'personal';
  const slug = options.slug?.trim() || '';
  if (!personaSlugPattern.test(slug)) {
    throw new Error('Persona slug must use lowercase letters, numbers, and single hyphens');
  }

  const root = personaLibraryRoot(scope, options);
  const path = resolve(root, `${slug}.md`);
  if (existsSync(path) && !options.force) {
    throw new Error(`Persona already exists: ${path}`);
  }

  const name = options.name?.trim() || personaName(slug);
  const category = options.category?.trim() || 'general';
  mkdirSync(root, { recursive: true });
  writeFileSync(path, personaTemplate({ scope, slug, name, category }), 'utf8');

  return {
    schema: 'ewai.persona-create-result/v1',
    id: `${scope}.${slug}`,
    scope,
    path
  };
}
