#!/usr/bin/env node
import { resolve } from 'node:path';
import { install } from '../src/install.mjs';

const args = process.argv.slice(2);

function option(name, fallback = '') {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

const project = option('--project');
const result = install({
  scope: project ? 'project' : 'global',
  projectRoot: project ? resolve(project) : '',
  host: option('--host', 'auto'),
  mode: option('--mode', project ? 'copy' : 'link'),
  force: args.includes('--force')
});

console.log(JSON.stringify(result, null, 2));
