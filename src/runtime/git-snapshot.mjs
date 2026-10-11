import { execFileSync } from 'node:child_process';

// Git history is read locally and never changes canonical SPECS or delivery evidence.
export function gitOutput(root, args, timeout = 8000) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      timeout,
      maxBuffer: 2_000_000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return '';
  }
}

export function gitCommit(root) {
  return gitOutput(root, ['rev-parse', 'HEAD'], 2000).trim();
}

export function fileHistory(root, relativePath) {
  const commit = gitCommit(root);
  if (!commit) return { available: false, commits: [], authors: {}, blameAuthors: {}, blameLines: 0 };
  const log = gitOutput(root, ['log', '-n', '80', '--pretty=%an%x09%s', '--', relativePath]);
  const commits = log.split('\n').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    return {
      author: tab < 0 ? line : line.slice(0, tab),
      subject: tab < 0 ? '' : line.slice(tab + 1)
    };
  });
  const authors = {};
  for (const entry of commits) authors[entry.author] = (authors[entry.author] ?? 0) + 1;
  const blame = gitOutput(root, ['blame', '--line-porcelain', '--', relativePath]);
  const blameAuthors = {};
  let blameLines = 0;
  for (const line of blame.split('\n')) {
    if (!line.startsWith('author ')) continue;
    const author = line.slice(7);
    blameAuthors[author] = (blameAuthors[author] ?? 0) + 1;
    blameLines += 1;
  }
  return { available: true, commits, authors, blameAuthors, blameLines };
}

export function coChangingFiles(root, relativePath, limit = 5) {
  const text = gitOutput(root, ['log', '-n', '40', '--name-only', '--pretty=format:COMMIT', '--', relativePath]);
  const counts = new Map();
  for (const line of text.split('\n')) {
    const path = line.trim();
    if (!path || path === 'COMMIT' || path === relativePath) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([path, changes]) => ({ path, changes }));
}

export function churnCounts(root) {
  const text = gitOutput(root, ['log', '-n', '200', '--name-only', '--pretty=format:']);
  const counts = new Map();
  for (const line of text.split('\n')) {
    const path = line.trim();
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

export function recentChangeSizes(root, limit = 30) {
  const text = gitOutput(root, ['log', `-n`, String(limit), '--shortstat', '--pretty=format:COMMIT']);
  const sizes = [];
  for (const block of text.split('COMMIT')) {
    const match = block.match(/(\d+) insertion/);
    const removed = block.match(/(\d+) deletion/);
    const files = block.match(/(\d+) files? changed/);
    if (!files) continue;
    sizes.push(Number(match?.[1] ?? 0) + Number(removed?.[1] ?? 0));
  }
  return sizes;
}

export function diffNumstat(root, base = 'HEAD') {
  const text = gitOutput(root, ['diff', '--numstat', base]);
  return text.split('\n').filter(Boolean).map((line) => {
    const [added, removed, path] = line.split('\t');
    return {
      path,
      added: added === '-' ? 0 : Number(added ?? 0),
      removed: removed === '-' ? 0 : Number(removed ?? 0)
    };
  }).filter((entry) => entry.path);
}
