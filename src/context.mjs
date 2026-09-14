import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import YAML from 'yaml';
import { projectPaths } from './paths.mjs';

const classifications = new Set(['public', 'internal', 'confidential', 'restricted']);
const cloudPolicies = new Set(['allowed', 'denied', 'unknown']);
const ignoredDirectories = new Set([
  '.git', '.ewai-pipeline', '.idea', '.vscode', 'node_modules', 'vendor', 'dist', 'build'
]);
const supportedExtensions = new Set([
  '.csv', '.doc', '.docx', '.eml', '.htm', '.html', '.ics', '.json', '.log', '.markdown',
  '.mbox', '.md', '.msg', '.odt', '.ods', '.pdf', '.ppt', '.pptx', '.rtf', '.text', '.tsv',
  '.txt', '.xls', '.xlsx', '.xml', '.yaml', '.yml',
  '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp',
  '.m4a', '.mp3', '.mp4', '.wav', '.webm'
]);

function normalized(path) {
  return path.split(sep).join('/');
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project-context';
}

function dateStamp(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function scanSource(root, exclusions, maxFiles) {
  const files = [];
  const skipped = { symlinks: 0, unsupported: 0, excluded: 0 };

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      const sourceRelative = normalized(relative(root, path));
      if (exclusions.some((excluded) => sourceRelative === excluded || sourceRelative.startsWith(`${excluded}/`))) {
        skipped.excluded += 1;
        continue;
      }
      if (entry.isSymbolicLink()) {
        skipped.symlinks += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!supportedExtensions.has(extension)) {
        skipped.unsupported += 1;
        continue;
      }
      if (files.length >= maxFiles) throw new Error(`Context folder exceeds the ${maxFiles} file registration limit; narrow the folder or add exclusions`);
      const stats = statSync(path);
      files.push({
        relativePath: sourceRelative,
        extension,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString()
      });
    }
  }

  walk(root);
  return { files, skipped };
}

function inventorySummary(files) {
  const extensions = {};
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    extensions[file.extension] = (extensions[file.extension] ?? 0) + 1;
  }
  return { fileCount: files.length, totalBytes, extensions };
}

function readRegistry(path) {
  if (!existsSync(path)) return { schema: 'ewai.context-source-registry/v1', sources: [] };
  const registry = YAML.parse(readFileSync(path, 'utf8')) ?? {};
  registry.schema ??= 'ewai.context-source-registry/v1';
  registry.sources ??= [];
  return registry;
}

export function registerContextSource(projectRoot, sourcePath, options = {}) {
  if (!options.confirmed) throw new Error('Context registration requires explicit user confirmation');
  const paths = projectPaths(projectRoot);
  if (!existsSync(paths.configPath)) throw new Error('Initialize EWAI before registering project context');

  const candidate = resolve(sourcePath);
  if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) {
    throw new Error(`Context source is not a readable folder: ${candidate}`);
  }
  const sourceRoot = realpathSync(candidate);
  const project = realpathSync(paths.projectRoot);
  if (sourceRoot === project) throw new Error('Choose a dedicated context folder rather than the entire project');
  if (inside(sourceRoot, project)) throw new Error('Choose a context folder that does not contain the project itself');

  const classification = options.classification ?? 'confidential';
  if (!classifications.has(classification)) throw new Error(`Unsupported context classification: ${classification}`);
  const cloudProcessing = options.cloudProcessing ?? 'unknown';
  if (!cloudPolicies.has(cloudProcessing)) throw new Error(`Unsupported cloud-processing policy: ${cloudProcessing}`);

  const label = String(options.label || basename(sourceRoot)).trim();
  const slug = slugify(label);
  const exclusions = (options.exclusions ?? [])
    .map((item) => normalized(String(item).replace(/^\.\//, '').replace(/\/$/, '')))
    .filter(Boolean);
  const registeredAt = new Date(options.now ?? Date.now()).toISOString();
  const scanned = scanSource(sourceRoot, exclusions, options.maxFiles ?? 10_000);
  const inventory = inventorySummary(scanned.files);
  const sourceHash = createHash('sha256').update(`${project}\0${sourceRoot}`).digest('hex').slice(0, 12);
  const sourceId = `context.${slug}.${sourceHash}`;
  const inventoryFingerprint = createHash('sha256').update(JSON.stringify(scanned.files)).digest('hex');

  const privateRoot = resolve(paths.runtimeRoot, 'context/sources');
  const privateManifest = resolve(privateRoot, `${sourceId}.json`);
  if (existsSync(privateManifest) && !options.force) {
    throw new Error(`Context source is already registered: ${sourceId}`);
  }
  mkdirSync(privateRoot, { recursive: true });
  writeFileSync(privateManifest, `${JSON.stringify({
    schema: 'ewai.context-source-private/v1',
    sourceId,
    label,
    sourceRoot,
    classification,
    cloudProcessing,
    exclusions,
    registeredAt,
    inventoryFingerprint,
    files: scanned.files,
    skipped: scanned.skipped
  }, null, 2)}\n`, 'utf8');

  const registryPath = resolve(paths.specsRoot, '1.Scope/research/context-sources.yaml');
  const registry = readRegistry(registryPath);
  const publicEntry = {
    id: sourceId,
    label,
    classification,
    cloud_processing: cloudProcessing,
    status: 'registered',
    registered_at: registeredAt,
    inventory: {
      file_count: inventory.fileCount,
      total_bytes: inventory.totalBytes,
      extensions: inventory.extensions
    },
    inventory_fingerprint: inventoryFingerprint,
    review_status: 'pending'
  };
  registry.sources = registry.sources.filter((source) => source.id !== sourceId);
  registry.sources.push(publicEntry);
  mkdirSync(resolve(paths.specsRoot, '1.Scope/research'), { recursive: true });
  writeFileSync(registryPath, YAML.stringify(registry, { lineWidth: 0 }), 'utf8');

  const bundleRoot = resolve(
    paths.specsRoot,
    '3.Evidence/context-imports',
    `${dateStamp(registeredAt)}-${slug}-${sourceHash}`
  );
  mkdirSync(bundleRoot, { recursive: true });
  const registrationPath = resolve(bundleRoot, 'source-registration.yaml');
  writeFileSync(registrationPath, YAML.stringify({
    schema: 'ewai.context-source-registration/v1',
    ...publicEntry,
    private_manifest: `.ewai-pipeline/context/sources/${sourceId}.json`,
    analysis_status: 'pending'
  }, { lineWidth: 0 }), 'utf8');

  return {
    schema: 'ewai.context-register-result/v1',
    projectRoot: paths.projectRoot,
    sourceId,
    label,
    classification,
    cloudProcessing,
    inventory,
    skipped: scanned.skipped,
    privateManifest,
    registryPath,
    bundleRoot,
    registrationPath
  };
}
