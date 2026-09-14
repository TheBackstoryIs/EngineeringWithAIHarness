import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, supportsNodeVersion } from '../src/launcher.mjs';

test('recognises the minimum supported Node release', () => {
  assert.equal(supportsNodeVersion('22.4.1'), false);
  assert.equal(supportsNodeVersion('22.5.0'), true);
  assert.equal(supportsNodeVersion('24.0.0'), true);
});

test('stops before loading the CLI and explains an unsupported Node release', async () => {
  let error = '';
  let cliLoaded = false;

  const exitCode = await launch([], {
    nodeVersion: '20.18.1',
    writeError: (message) => {
      error += message;
    },
    loadCli: async () => {
      cliLoaded = true;
      return { run() {} };
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(cliLoaded, false);
  assert.match(error, /EWAI requires Node\.js 22\.5 or newer/);
  assert.match(error, /currently running Node\.js 20\.18\.1/);
  assert.match(error, /node --version/);
});

test('a bare invocation launches the companion without loading the command CLI', async () => {
  let companionLaunched = false;
  let cliLoaded = false;

  const exitCode = await launch([], {
    nodeVersion: '24.0.0',
    loadCompanion: async () => ({
      runCompanion: async () => {
        companionLaunched = true;
        return 0;
      }
    }),
    loadCli: async () => {
      cliLoaded = true;
      return { run() {} };
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(companionLaunched, true);
  assert.equal(cliLoaded, false);
});
