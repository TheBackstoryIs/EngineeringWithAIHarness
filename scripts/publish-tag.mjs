import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function publishTagForVersion(version) {
  if (/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) return 'beta';
  if (/^\d+\.\d+\.\d+$/.test(version)) return 'latest';
  throw new Error(`Unsupported npm release version: ${version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  process.stdout.write(`${publishTagForVersion(metadata.version)}\n`);
}
