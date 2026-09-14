const MINIMUM_NODE_VERSION = [22, 5, 0];

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  return match ? match.slice(1).map(Number) : null;
}

export function supportsNodeVersion(version) {
  const current = versionParts(version);
  if (!current) return false;

  for (let index = 0; index < MINIMUM_NODE_VERSION.length; index += 1) {
    if (current[index] > MINIMUM_NODE_VERSION[index]) return true;
    if (current[index] < MINIMUM_NODE_VERSION[index]) return false;
  }
  return true;
}

function unsupportedNodeMessage(nodeVersion) {
  return [
    'EWAI requires Node.js 22.5 or newer.',
    `This terminal is currently running Node.js ${nodeVersion}.`,
    '',
    'Upgrade Node.js, open a new terminal, and verify the active version with:',
    '  node --version',
    '',
    'Your EWAI installation can remain in place; run `ewai` again after Node is upgraded.',
    ''
  ].join('\n');
}

export async function launch(args, options = {}) {
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const writeError = options.writeError ?? ((message) => process.stderr.write(message));

  if (!supportsNodeVersion(nodeVersion)) {
    writeError(unsupportedNodeMessage(nodeVersion));
    return 1;
  }

  if (!args.length) {
    const loadCompanion = options.loadCompanion ?? (() => import('./companion.mjs'));
    const { runCompanion } = await loadCompanion();
    return runCompanion(options.companionOptions);
  }

  const loadCli = options.loadCli ?? (() => import('./cli.mjs'));
  const { run } = await loadCli();
  await run(args);
  return process.exitCode ?? 0;
}
