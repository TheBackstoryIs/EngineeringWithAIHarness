#!/usr/bin/env node
import { executeAfkRun } from './runtime/afk-conductor.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : process.argv[index + 1] ?? '';
}

const projectRoot = option('--project');
const runId = option('--run');
if (!projectRoot || !runId) {
  console.error('Usage: afk-worker --project PATH --run RUN_ID');
  process.exitCode = 2;
} else {
  await executeAfkRun(projectRoot, runId);
}
