import {createHash, randomUUID} from 'node:crypto';
import {accessSync, constants, existsSync, lstatSync, realpathSync, readFileSync, readdirSync, mkdirSync, openSync, closeSync, fstatSync, writeFileSync, fsyncSync, renameSync, unlinkSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadProjectConfig} from '../project.mjs';
import {projectPaths} from '../paths.mjs';
import {readDeliveryState} from '../delivery.mjs';
import {validateIntentStateCopies} from '../intents.mjs';
import {requiredPhaseArtefacts} from '../delivery-artifacts.mjs';

export const MAX_FILE_BYTES = 256 * 1024;
export const hash = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
  return value;
}
export const requestHash = value => hash(JSON.stringify(canonical(value)));
export function fail(code) { const error = new Error(`Project operation refused: ${code}.`); error.code = code; throw error; }
export function closed(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) fail('invalid-input');
}
export function identifier(value) { if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 100) fail('invalid-identifier'); return value; }
export function operationId(value) { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) fail('invalid-operation-id'); return value; }
export function localPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || isAbsolute(value) || /[\\\x00-\x1f\x7f:]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail('unsafe-path');
  return value;
}
export function within(root, path) { const local = relative(root, path); return local === '' || !local.startsWith('..') && !isAbsolute(local); }
export function sameFile(left,right) {
  try{const a=lstatSync(left),b=lstatSync(right);return a.dev===b.dev&&a.ino===b.ino;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}
export function physicalWithin(root,path) {
  let cursor=path;
  while(true){if(sameFile(root,cursor))return true;const parent=dirname(cursor);if(parent===cursor)return false;cursor=parent;}
}
export function safePath(root, path) {
  if (!within(root, path)) fail('unsafe-path');
  let cursor = root;
  for (const part of relative(root, path).split('/').filter(Boolean)) {
    cursor = resolve(cursor, part);
    let stat; try { stat = lstatSync(cursor); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) fail('unsafe-path');
  }
  return path;
}
export function readBytes(root, path, limit = MAX_FILE_BYTES) {
  safePath(root, path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > limit) fail('unsafe-file-size-or-type');
    const bytes = readFileSync(fd), after = fstatSync(fd), current = lstatSync(safePath(root, path));
    if (bytes.length > limit || before.ino !== current.ino || before.dev !== current.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('file-changed');
    return bytes;
  } finally { closeSync(fd); }
}
export function readJson(root, path) { try { return JSON.parse(readBytes(root, path, 2 * 1024 * 1024)); } catch (error) { if (error.code) throw error; fail('invalid-record'); } }
export function atomicRecord(root, path, value, exclusive = false) {
  safePath(root, path); mkdirSync(dirname(path), {recursive:true, mode:0o700}); safePath(root, path);
  if (exclusive) {
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    return;
  }
  const temp = safePath(root, `${path}.${randomUUID()}.tmp`), fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  try { safePath(root, path); renameSync(temp, path); } finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function writable(root, path) {
  try { safePath(root, path); let parent = path; while (!existsSync(parent)) parent = dirname(parent); accessSync(parent, constants.W_OK); return true; } catch { return false; }
}
export function git(repo, args) {
  try { return execFileSync('git', args, {cwd:repo, encoding:'utf8', timeout:10000, maxBuffer:4*1024*1024, stdio:['ignore','pipe','ignore']}); } catch { fail('repository-check-failed'); }
}
export function environment() {
  return Object.fromEntries(['PATH','SystemRoot','TMPDIR','TEMP','TMP','LANG'].filter(key => process.env[key]).map(key => [key,process.env[key]]).concat([['CI','1'],['GIT_TERMINAL_PROMPT','0']]));
}
export function context(projectRoot, enabled = true) {
  const root = realpathSync(projectRoot), initial = projectPaths(root);
  safePath(root, initial.runtimeProjectPath); safePath(root, initial.configPath);
  const {config, paths} = loadProjectConfig(root), policy = config.remote_operations ?? {enabled:false};
  closed(policy, ['enabled','allow_code_writes','checks']);
  if (typeof policy.enabled !== 'boolean' || policy.allow_code_writes !== undefined && typeof policy.allow_code_writes !== 'boolean') fail('invalid-policy');
  if (enabled && !policy.enabled) fail('remote-operations-disabled');
  const repositories = new Map();
  for (const repo of config.repositories ?? []) {
    identifier(repo.name);
    if (repositories.has(repo.name) || typeof repo.path !== 'string') fail('invalid-repository-config');
    const configured = resolve(root, repo.path);
    if (lstatSync(configured).isSymbolicLink()) fail('unsafe-repository-path');
    repositories.set(repo.name, realpathSync(configured));
  }
  const checks = policy.checks ?? {};
  if (!checks || typeof checks !== 'object' || Array.isArray(checks) || Object.keys(checks).length > 40) fail('invalid-check-policy');
  for (const [name, check] of Object.entries(checks)) {
    identifier(name); closed(check, ['repository','executable','args','phases','timeout_ms','max_output_bytes']);
    if (!repositories.has(check.repository) || typeof check.executable !== 'string' || !isAbsolute(check.executable) || /[\x00-\x1f]/.test(check.executable)
      || !Array.isArray(check.args) || check.args.length > 64 || check.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))
      || !Array.isArray(check.phases) || !check.phases.length || check.phases.some(phase => !/^[a-z-]+$/.test(phase))
      || !Number.isInteger(check.timeout_ms) || check.timeout_ms < 100 || check.timeout_ms > 600000
      || !Number.isInteger(check.max_output_bytes) || check.max_output_bytes < 16 || check.max_output_bytes > 1048576) fail('invalid-check-policy');
  }
  return {...paths, root, config, policy, repositories, checks, configDigest:hash(readBytes(root, paths.configPath)), operationsRoot:resolve(paths.runtimeRoot,'runtime/project-operations')};
}
export function phaseContext(ctx, slug, phase) {
  identifier(slug);
  const deliveryRoot = safePath(ctx.root, resolve(ctx.buildRoot, slug));
  safePath(ctx.root, resolve(deliveryRoot,'delivery-state.json'));
  const state = readDeliveryState(ctx.root, slug);
  if (state.status !== 'in-progress' || phase !== undefined && state.currentPhase !== phase) fail('phase-conflict');
  const current = [...state.phases,...state.adjuncts,...state.humanGates].find(item => item.id === state.currentPhase);
  if (!current || !['running','pending'].includes(current.status) || state.currentPhase === 'manual-qa') fail('phase-not-writable');
  safePath(ctx.root, resolve(ctx.root, state.intent.path));
  validateIntentStateCopies(ctx.root, resolve(ctx.root,state.intent.path), {status:state.intent.status,deliveryStatus:state.status,currentPhase:state.currentPhase,deliveryStatePath:relative(ctx.root,resolve(deliveryRoot,'delivery-state.json')).replaceAll('\\','/')});
  return {state, deliveryRoot, phase:state.currentPhase};
}
export function repository(ctx, name) { if (!ctx.repositories.has(name)) fail('unknown-repository'); return ctx.repositories.get(name); }
export function protectedFile(ctx, repo, path, writing = false) {
  const name = localPath(path), target = resolve(repo, name), parts = name.toLowerCase().split('/');
  if (parts.some(part => ['.git','.ewai-pipeline','.ssh','.aws','.azure','.claude','.codex','.grok','.agents','node_modules','vendor'].includes(part))
    || parts.some(part => /^\.env(?:\.|$)/.test(part) || /^(?:credentials|secrets?)(?:\.|$)/.test(part) || /\.(?:pem|key|p12|pfx|keystore)$/.test(part))
    || parts.some(part=>['.npmrc','.netrc','.pypirc','.mcp.json','auth.json'].includes(part))
    || target === ctx.configPath || sameFile(target,ctx.configPath) || writing && ['agents.md','claude.md'].includes(parts.at(-1))
    || writing && physicalWithin(ctx.specsRoot,target)) fail('protected-path');
  return safePath(repo, target);
}
export function snapshot(ctx) {
  const result = {};
  for (const [name, repo] of ctx.repositories) {
    const head = git(repo,['rev-parse','HEAD']).trim(), branch = git(repo,['branch','--show-current']).trim();
    const files = [...new Set(git(repo,['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean))].sort();
    if (files.length > 20000) fail('revision-inventory-limit');
    const digest = createHash('sha256'); let bytes = 0;
    for (const file of files) {
      localPath(file); const path = resolve(repo,file);
      if (within(ctx.specsRoot,path) || within(ctx.runtimeRoot,path)) continue;
      digest.update(file+'\0');
      if (!existsSync(path)) { digest.update('missing\0'); continue; }
      const stat = lstatSync(safePath(repo,path));
      if (!stat.isFile() || stat.size > 4*1024*1024 || (bytes += stat.size) > 64*1024*1024) fail('revision-inventory-limit');
      digest.update(hash(readBytes(repo,path,4*1024*1024))+'\0');
    }
    result[name] = {head,branch,sha256:digest.digest('hex')};
  }
  return result;
}
export function phaseFingerprint(ctx,current) {
  const files=new Set(['delivery-state.json','task-graph.json','gates/plan/claim-ledger.json','gates/plan/plan-contract.json','gates/build/build-approval.json'].map(path=>resolve(current.deliveryRoot,path)));
  files.add(safePath(ctx.root,resolve(ctx.root,current.state.intent.path)));
  files.add(safePath(ctx.root,resolve(ctx.root,current.state.intent.path.replace(/\.md$/,'.json'))));
  for(const path of requiredPhaseArtefacts(current.deliveryRoot,current.phase)){
    if(/(?:-check\.(?:md|json)|gate-ledger\.json)$/.test(path)||path.includes('('))continue;
    files.add(safePath(ctx.root,resolve(current.deliveryRoot,localPath(path))));
  }
  // Standards can live outside the Git-visible inventory, including ignored SPECS.
  function collect(directory) {
    if(!existsSync(safePath(ctx.root,directory)))return;
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      const path=safePath(ctx.root,resolve(directory,entry.name));
      if(entry.isDirectory())collect(path);else files.add(path);
      if(files.size>10000)fail('revision-inventory-limit');
    }
  }
  collect(resolve(current.deliveryRoot,'evidence/authored',current.phase));
  collect(resolve(ctx.specsRoot,'4.Constraints'));collect(resolve(ctx.specsRoot,'5.Strategy'));
  const digest=createHash('sha256');let total=0;
  for(const path of [...files].sort()){
    digest.update(relative(ctx.root,path)+'\0');
    if(!existsSync(path)){digest.update('missing\0');continue;}
    const bytes=readBytes(ctx.root,path,2*1024*1024);total+=bytes.length;if(total>32*1024*1024)fail('revision-inventory-limit');digest.update(hash(bytes)+'\0');
  }
  return digest.digest('hex');
}
export function operationPaths(ctx, slug, id) {
  identifier(slug); operationId(id);
  const runtime = safePath(ctx.root,resolve(ctx.operationsRoot,id));
  const evidenceRoot = safePath(ctx.root,resolve(ctx.buildRoot,slug,'evidence/project-operations'));
  return {runtime, attempt:resolve(runtime,'attempt.json'), launch:resolve(runtime,'launch.json'), heartbeat:resolve(runtime,'heartbeat.json'), cancel:resolve(runtime,'cancel.json'), receipt:resolve(evidenceRoot,id+'.json'), output:resolve(evidenceRoot,id+'.log'), lock:resolve(ctx.operationsRoot,'project.lock')};
}
export function reserve(ctx, paths, slug, id) {
  safePath(ctx.root,paths.lock); mkdirSync(dirname(paths.lock),{recursive:true,mode:0o700});
  try { atomicRecord(ctx.root,paths.lock,{schema:'ewai.project-reservation/v1',slug,operationId:id,pid:process.pid,createdAt:new Date().toISOString()},true); } catch (error) { if (error.code === 'EEXIST') fail('project-busy'); throw error; }
}
export function release(ctx, paths, id) {
  if (existsSync(paths.lock) && readJson(ctx.root,paths.lock).operationId === id) unlinkSync(safePath(ctx.root,paths.lock));
}
export function readAttempt(ctx, paths, slug, id) {
  if (!existsSync(safePath(ctx.root,paths.attempt))) fail('unknown-operation');
  const attempt = readJson(ctx.root,paths.attempt);
  if (attempt.slug !== slug || attempt.operationId !== id || attempt.schema !== 'ewai.project-operation/v1') fail('invalid-record');
  return attempt;
}
export function receipt(ctx, paths, value) {
  const body = {...value,completedAt:new Date().toISOString()};
  atomicRecord(ctx.root,paths.receipt,{...body,sha256:hash(JSON.stringify(body))},true);
  return body;
}
export function readReceipt(ctx, paths) {
  if (!existsSync(safePath(ctx.root,paths.receipt))) return null;
  const {sha256,...record} = readJson(ctx.root,paths.receipt);
  if (sha256 !== hash(JSON.stringify(record))) fail('receipt-changed');
  return {...record,sha256};
}
