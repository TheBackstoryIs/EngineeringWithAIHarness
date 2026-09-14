import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { listDesignSystems, parseDesignSystemPack, projectDesignSystem } from './design-systems.mjs';

const scopes = new Set(['project', 'personal']);

function candidatePack(folder, options = {}) {
  const candidateRoot = realpathSync(resolve(folder));
  const manifestPath = resolve(candidateRoot, 'pack.yaml');
  if (!existsSync(manifestPath)) throw new Error('Design-system candidate must contain pack.yaml at its root');
  const pack = parseDesignSystemPack(manifestPath, 'candidate', options);
  if (!pack) throw new Error('Candidate pack.yaml is not a design-system pack');
  return { candidateRoot, manifestPath, pack };
}

function safeCandidate(pack) {
  return { schema: 'ewai.design-system-candidate/v1', ...projectDesignSystem(pack), digest: pack.digest };
}

export function validateDesignSystemCandidate(folder, options = {}) {
  return safeCandidate(candidatePack(folder, options).pack);
}

function installationDestination(projectRoot, pack, scope, options = {}) {
  if (!scopes.has(scope)) throw new Error(`Unsupported design-system installation scope: ${scope}`);
  const parent = scope === 'project'
    ? resolve(projectRoot, '.ewai-pipeline/packs')
    : resolve(options.home ?? homedir(), '.ewai/packs');
  return { parent, destination: resolve(parent, pack.id.replaceAll('.', '-')) };
}

export function previewDesignSystemInstallation(projectRoot, folder, options = {}) {
  const scope = String(options.scope ?? '').trim();
  const { candidateRoot, pack } = candidatePack(folder, options);
  const { destination } = installationDestination(projectRoot, pack, scope, options);
  const catalogue = listDesignSystems({ projectRoot, ...(options.home ? { home: options.home } : {}) });
  const identityConflict = catalogue.find(({ id }) => id === pack.id);
  const destinationConflict = existsSync(destination);
  return {
    schema: 'ewai.design-system-installation-preview/v1',
    status: identityConflict || destinationConflict ? 'conflict' : 'ready',
    id: pack.id,
    name: pack.name,
    version: pack.version,
    digest: pack.digest,
    scope,
    source: candidateRoot,
    destination,
    conflict: Boolean(identityConflict || destinationConflict),
    conflicts: [
      ...(identityConflict ? [{ kind: 'installed-id', id: identityConflict.id, version: identityConflict.version, sourceClass: identityConflict.sourceClass }] : []),
      ...(destinationConflict ? [{ kind: 'destination-exists' }] : []),
    ],
    dependencies: [...pack.requires],
    contributions: projectDesignSystem(pack).contributions,
    notice: 'Installation creates a new pack only. It does not select the pack for this project.',
  };
}

function copyCandidateFiles(candidateRoot, pack, stage) {
  mkdirSync(stage, { recursive: false });
  copyFileSync(resolve(candidateRoot, 'pack.yaml'), resolve(stage, 'pack.yaml'));
  for (const source of [...new Set(pack.design_system.contributions.map(({ source: path }) => path))].sort()) {
    const destination = resolve(stage, source);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(candidateRoot, source), destination);
  }
}

export function installDesignSystemCandidate(projectRoot, folder, options = {}) {
  if (options.confirmed !== true) throw new Error('Design-system installation requires explicit confirmation');
  const expectedDigest = String(options.expectedDigest ?? '').trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('Design-system installation requires an exact expected digest');
  const scope = String(options.scope ?? '').trim();
  const { candidateRoot, pack } = candidatePack(folder, options);
  if (pack.digest !== expectedDigest) throw new Error(`Design-system candidate digest drift: expected ${expectedDigest}, resolved ${pack.digest}`);
  const preview = previewDesignSystemInstallation(projectRoot, candidateRoot, { ...options, scope });
  if (preview.conflict) throw new Error(`Design system ${pack.id}@${pack.version} is already installed or its destination already exists`);
  const parent = dirname(preview.destination);
  mkdirSync(parent, { recursive: true });
  const stage = resolve(parent, `.${basename(preview.destination)}.stage-${process.pid}-${randomUUID()}`);
  try {
    copyCandidateFiles(candidateRoot, pack, stage);
    const staged = parseDesignSystemPack(resolve(stage, 'pack.yaml'), scope, options);
    if (staged.digest !== expectedDigest) throw new Error('Staged design-system digest does not match the reviewed candidate');
    options.beforeCommit?.({ stage, destination: preview.destination, pack: staged });
    if (existsSync(preview.destination)) throw new Error('Design-system destination appeared after preview; refusing overwrite');
    renameSync(stage, preview.destination);
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return {
    schema: 'ewai.design-system-installation/v1', status: 'installed', id: pack.id,
    version: pack.version, digest: pack.digest, scope, destination: preview.destination,
    selected: false,
    notice: 'The pack is installed but not selected. Use the separate digest-reviewed selection command when appropriate.',
  };
}
