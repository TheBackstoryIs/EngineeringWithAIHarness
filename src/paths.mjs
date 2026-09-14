import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path';

export const PROJECT_MARKERS = [
  'SPECS/pipeline.yaml',
  '.ewai-pipeline/project.json',
  '.git'
];

export function resolveProjectRoot(start = process.cwd()) {
  let current = realpathSync(resolve(start));
  const filesystemRoot = parse(current).root;
  let nearestGit = '';

  while (true) {
    if (existsSync(resolve(current, '.ewai-pipeline/project.json')) || existsSync(resolve(current, 'SPECS/pipeline.yaml'))) return current;
    if (!nearestGit && existsSync(resolve(current, '.git'))) nearestGit = current;
    if (current === filesystemRoot) break;
    current = dirname(current);
  }

  if (nearestGit) return nearestGit;

  throw new Error(`No EWAI project or Git repository found from ${resolve(start)}`);
}

function within(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function runtimeSpecsRoot(root, runtimeProjectPath) {
  if (!existsSync(runtimeProjectPath)) return '';
  try {
    const runtime = JSON.parse(readFileSync(runtimeProjectPath, 'utf8'));
    return String(runtime.specsRoot ?? '').trim();
  } catch {
    return '';
  }
}

export function projectPaths(projectRoot, options = {}) {
  const root = resolve(projectRoot);
  const runtimeRoot = resolve(root, '.ewai-pipeline');
  const runtimeProjectPath = resolve(runtimeRoot, 'project.json');
  const configured = String(options.specsRoot ?? runtimeSpecsRoot(root, runtimeProjectPath) ?? '').trim() || 'SPECS';
  const specsRoot = isAbsolute(configured) ? resolve(configured) : resolve(root, configured);
  if (!within(root, specsRoot)) throw new Error(`SPECS root must stay inside the EWAI workspace: ${configured}`);
  const specsRelative = relative(root, specsRoot).replaceAll('\\', '/') || '.';

  return {
    projectRoot: root,
    specsRoot,
    specsRelative,
    configPath: resolve(specsRoot, 'pipeline.yaml'),
    discoveryPath: resolve(specsRoot, '2.Purpose/explorations/project-discovery.md'),
    personaRoot: resolve(specsRoot, '1.Scope/personas'),
    buildRoot: resolve(specsRoot, '6.Build'),
    runtimeRoot,
    runtimeProjectPath
  };
}
