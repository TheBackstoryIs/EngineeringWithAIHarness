import { accessSync, constants, createWriteStream, mkdirSync, existsSync, realpathSync, lstatSync, openSync, readSync, readFileSync, closeSync, fstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { release, tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { CONTEXT_ESTIMATE_METHOD, estimateContextTokens } from './context-assembly.mjs';
import {modelGuidance, readCodingPolicy, assertCodingPolicyFresh} from '../coding-providers.mjs';
import {prepareGrokRuntime, parseGrokWorkerResult, prepareGrokTaskSnapshot, acceptGrokTaskSnapshot, assertGrokTaskEvidenceFresh} from './grok-provider.mjs';

export const AFK_PROVIDERS = Object.freeze(['codex', 'claude', 'antigravity']);
export const SUPPORTED_AFK_PROVIDERS = Object.freeze([...AFK_PROVIDERS,'grok']);
const grokInvocations = new WeakMap();
// Retain owned child handles after an uncertain stop; do not turn a missing
// close event into success or lose the ability to observe a later exit.
const unsettledProcesses = new Set();

export function measureProviderPrompt(prompt) {
  const measurement = estimateContextTokens(prompt);
  return {
    bytes: measurement.bytes,
    estimatedTokens: measurement.estimatedTokens,
    estimateMethod: CONTEXT_ESTIMATE_METHOD,
  };
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function normaliseProviderUsage(provider, usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const inputTokens = nonNegativeInteger(usage.inputTokens ?? usage.input_tokens);
  const cachedInputTokens = nonNegativeInteger(
    usage.cachedInputTokens ?? usage.cached_input_tokens ?? usage.cache_read_input_tokens,
  );
  const outputTokens = nonNegativeInteger(usage.outputTokens ?? usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  return {
    schema: 'ewai.provider-usage/v1',
    provider: String(provider ?? ''),
    inputTokens,
    cachedInputTokens: cachedInputTokens ?? 0,
    outputTokens,
    source: 'provider-reported',
  };
}

export function providerCommand(provider) {
  return provider === 'antigravity' ? 'agy' : provider;
}

export function commandAvailable(command, env = process.env) {
  const candidates = isAbsolute(command)
    ? [command]
    : String(env.PATH ?? '').split(delimiter).filter(Boolean).map((entry) => resolve(entry, command));
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function captureProviderIdentity(provider) {
  if(!SUPPORTED_AFK_PROVIDERS.includes(provider))throw new Error('Provider identity is unavailable.');
  const executable=installedExecutable(providerCommand(provider));
  const version=spawnSync(executable,['--version'],{env:phaseEnv(),encoding:'utf8',timeout:5000,maxBuffer:1024});
  if(version.status!==0||version.error)throw new Error('Provider version is unavailable.');
  return {provider,identityDigest:'sha256:'+createHash('sha256').update(JSON.stringify([
    executableDigest(executable),version.stdout.trim(),release(),process.arch])).digest('hex')};
}

function claudeTools(task, mode) {
  if (mode === 'review') return ['Read', 'Glob', 'Grep'];
  const commands = (task?.allowed_commands ?? []).map((command) => `Bash(${command})`);
  return ['Read', 'Edit', 'Write', 'Glob', 'Grep', ...commands];
}

export function buildProviderInvocation(provider, input = {}) {
  if (!SUPPORTED_AFK_PROVIDERS.includes(provider)) throw new Error(`Unsupported AFK provider: ${provider}`);
  assertAfkMode(input.mode);
  const mode = input.mode === 'review' ? 'review' : 'implementation';
  const cwd = resolve(input.cwd);
  const model = String(input.model ?? '').trim();
  const invocation = {
    provider,
    command: providerCommand(provider),
    cwd,
    prompt: String(input.prompt ?? '')+modelGuidance(provider,input.codingPolicy),
    timeoutMs: Number(input.timeoutMs ?? 45 * 60 * 1000),
    mode,
    task: input.task ?? null,
    promptMeasurement: measureProviderPrompt(String(input.prompt ?? '')+modelGuidance(provider,input.codingPolicy)),
    providerUsage: normaliseProviderUsage(provider, input.providerUsage),
    args: [],
  };

  if (provider === 'grok') {
    if(model)throw new Error('Grok workers retain native model selection. Use an advisory model suggestion.');
    assertGrokTaskEvidenceFresh(input.grokEvidence,mode,{...input,prompt:invocation.prompt});
    const capability=prepareGrokBuildProvider(mode);
    if(capability.status!=='requires-conformance')throw new Error('Grok coding/review mode is unavailable: '+capability.code);
    const policyRoot=input.policyRoot??cwd,policyDigest=input.policyDigest??readCodingPolicy(policyRoot).policyDigest;
    grokInvocations.set(invocation,{handle:capability,policyRoot,policyDigest,evidence:input.grokEvidence,mode,
      input:{cwd,prompt:invocation.prompt,task:structuredClone(input.task),timeoutMs:invocation.timeoutMs}});
    invocation.identityDigest=capability.identityDigest;
    invocation.grokEvidence=input.grokEvidence;
  } else if (provider === 'codex') {
    invocation.args = ['--ask-for-approval', 'never', 'exec', '--color', 'never', '--sandbox', mode === 'review' ? 'read-only' : 'workspace-write', '-C', cwd];
    if (mode === 'implementation') invocation.args.splice(3, 0, '--json');
    if (model) invocation.args.push('--model', model);
    invocation.args.push('-');
  } else if (provider === 'claude') {
    invocation.args = [
      '-p',
      '--output-format', mode === 'review' ? 'text' : 'stream-json',
      '--permission-mode', mode === 'review' ? 'plan' : 'dontAsk',
      '--no-session-persistence',
      '--allowedTools', claudeTools(input.task, mode).join(','),
    ];
    if (model) invocation.args.push('--model', model);
    if (Number.isFinite(Number(input.maxBudgetUsd)) && Number(input.maxBudgetUsd) > 0) {
      invocation.args.push('--max-budget-usd', String(input.maxBudgetUsd));
    }
  } else {
    invocation.args = [
      '--print', invocation.prompt,
      '--output-format', mode === 'review' ? 'text' : 'stream-json',
      '--mode', mode === 'review' ? 'plan' : 'accept-edits',
      '--sandbox',
    ];
    if (mode === 'implementation') invocation.args.push('--dangerously-skip-permissions');
    if (model) invocation.args.push('--model', model);
  }
  return invocation;
}

export function invokeProvider(invocation, options = {}) {
  assertAfkMode(invocation.mode);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new Error('Invalid host cancellation signal.');
  if (options.signal?.aborted) return Promise.resolve({ provider: invocation.provider, exitCode: -1,
    signal: '', cancelled: true, timedOut: false, executionStopped: true, processGroupStopped: true,
    durationMs: 0, output: '', logPath: invocation.logPath, providerUsage: null });
  if(invocation.provider==='grok')return invokeGrokBuild(invocation,options);
  mkdirSync(resolve(invocation.logPath, '..'), { recursive: true });
  const output = createWriteStream(invocation.logPath, { flags: 'a' });
  const startedAt = Date.now();
  const maxCapture = Number(options.maxCaptureBytes ?? 1024 * 1024);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
    });
    options.onStart?.(child.pid);
    let captured = '';
    let timedOut = false;
    let cancelled = false, killTimer, stopDeadline, settled = false;
    const kill = signal => {
      try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch {}
    };
    const stop = () => {
      if (settled) return;
      kill('SIGTERM'); killTimer ??= setTimeout(() => kill('SIGKILL'), 250);
      stopDeadline ??= setTimeout(() => {
        if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(killTimer);
        options.signal?.removeEventListener('abort', cancel);
        unsettledProcesses.add(child); child.once('close', () => unsettledProcesses.delete(child));
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref(); output.end();
        resolvePromise({ provider: invocation.provider, status: 'unknown', exitCode: -1, signal: '',
          cancelled, timedOut, executionStopped: false, processGroupStopped: false, output: '',
          durationMs: Date.now() - startedAt, logPath: invocation.logPath, providerUsage: null });
      }, 1000);
    };
    const cancel = () => { cancelled = true; stop(); };
    const capture = (chunk) => {
      output.write(chunk);
      captured = `${captured}${chunk.toString('utf8')}`.slice(-maxCapture);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => {
      settled = true; clearTimeout(timeout); clearTimeout(killTimer); clearTimeout(stopDeadline); options.signal?.removeEventListener('abort', cancel);
      output.end();
      reject(error);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, invocation.timeoutMs);
    timeout.unref();
    child.once('close', async (exitCode, signal) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); clearTimeout(killTimer); clearTimeout(stopDeadline); options.signal?.removeEventListener('abort', cancel);
      let processGroupStopped = false;
      if (process.platform !== 'win32') {
        try { process.kill(-child.pid, 0); kill('SIGKILL'); }
        catch (error) { processGroupStopped = error.code === 'ESRCH'; }
      }
      output.end();
      resolvePromise({
        provider: invocation.provider,
        exitCode: exitCode ?? -1,
        signal: signal ?? '',
        timedOut,
        cancelled,
        processGroupStopped,
        // AFK tools can launch detached descendants. Group disappearance alone
        // is not proof of full-tree termination after cancellation or timeout.
        executionStopped: !cancelled && !timedOut && processGroupStopped,
        durationMs: Date.now() - startedAt,
        logPath: invocation.logPath,
        output: captured,
        promptMeasurement: invocation.promptMeasurement ?? measureProviderPrompt(invocation.prompt),
        providerUsage: normaliseProviderUsage(
          invocation.provider,
          options.providerUsage ?? invocation.providerUsage,
        ),
      });
    });
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.stdin.on('error', () => {});
    child.stdin.end(cancelled ? '' : invocation.prompt);
  });
}

function assertAfkMode(mode) {
  // Proposal workers have a different authority and output boundary. An
  // unrecognised mode must never silently acquire implementation permissions.
  if (mode === undefined || mode === 'implementation' || mode === 'review') return;
  const error = new Error('This mode is unavailable through the AFK provider transport.');
  error.code = 'phase-provider-mode-unavailable';
  throw error;
}

// Separate from AFK: capabilities are host-created, process-local handles, not
// serialisable worker/browser supplied executable paths or permission flags.
const phaseCapabilities = new WeakMap();
const unavailablePhase = code => ({ status: 'unavailable', code, requiresHuman: true });
const phaseVersions = Object.freeze({ claude: '2.1.257 (Claude Code)', grok: 'grok 1.0.44 (5b807183dd79) [stable]', sandbox: 'macos-seatbelt-phase-v1' });
const phaseEnv = () => ({ PATH: process.env.PATH ?? '', LANG: 'en_US.UTF-8' });

function installedExecutable(command) {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const path = resolve(directory, command);
    try { accessSync(path, constants.X_OK); return realpathSync(path); } catch {}
  }
  throw new Error('phase-provider-missing');
}

function executableDigest(path) {
  const before = lstatSync(path);
  // Package managers may hard-link installed executables. They are trusted
  // host code, unlike untrusted proposal files; bind their bytes and identity.
  if (!before.isFile() || before.size > 512 * 1024 * 1024) throw new Error('phase-provider-identity-invalid');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes; while ((bytes = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, bytes));
    const after = fstatSync(fd), current = lstatSync(path);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || after.nlink !== before.nlink || current.ino !== after.ino || current.mtimeMs !== after.mtimeMs) throw new Error('phase-provider-identity-changed');
    return hash.digest('hex');
  } finally { closeSync(fd); }
}

export function preparePhaseProvider(provider) {
  // Additional providers/platforms stay unavailable until the same executable
  // and configuration-isolation conformance has actually been demonstrated.
  if (!['claude', 'grok'].includes(provider) || process.platform !== 'darwin') return unavailablePhase('phase-provider-mode-unavailable');
  try {
    if (provider === 'grok' && ['managed_config.toml', 'requirements.toml'].some(name => existsSync(resolve('/etc/grok', name)))) return unavailablePhase('phase-provider-system-config-unverified');
    const executable = installedExecutable(provider), sandbox = realpathSync('/usr/bin/sandbox-exec');
    const version = path => {
      const result = spawnSync(path, ['--version'], { env: phaseEnv(), encoding: 'utf8', timeout: 5000, maxBuffer: 1024 });
      if (result.status !== 0 || result.error) throw new Error('phase-provider-version-unavailable');
      return result.stdout.trim();
    };
    if (version(executable) !== phaseVersions[provider]) return unavailablePhase('phase-provider-version-unverified');
    const hashes = [executableDigest(executable), executableDigest(sandbox)];
    const handle = Object.freeze({ status: 'requires-conformance', provider, version: phaseVersions[provider],
      sandboxVersion: phaseVersions.sandbox,
      identityDigest: createHash('sha256').update(JSON.stringify([hashes, release(), process.arch, phaseVersions.sandbox])).digest('hex') });
    phaseCapabilities.set(handle, { provider, mode:'phase', executable, sandbox, hashes, verified: false });
    return handle;
  } catch { return unavailablePhase('phase-provider-identity-unavailable'); }
}

export function prepareGrokBuildProvider(mode) {
  if(!['implementation','review'].includes(mode))return unavailablePhase('phase-provider-mode-unavailable');
  const phase=preparePhaseProvider('grok');if(phase.status!=='requires-conformance')return phase;
  const handle=Object.freeze({...phase,mode,identityDigest:createHash('sha256').update(phase.identityDigest+':grok-task-snapshot-v1:'+mode).digest('hex')});
  phaseCapabilities.set(handle,{...phaseCapabilities.get(phase),mode});return handle;
}

async function invokeGrokBuild(invocation,options) {
  const captured=grokInvocations.get(invocation),startedAt=Date.now();
  if(!captured)throw new Error('Grok invocation must be prepared by the host.');
  const failure=(code,stopped=true)=>({provider:'grok',exitCode:-1,status:'unavailable',code,
    executionStopped:stopped,output:'',logPath:invocation.logPath,durationMs:Date.now()-startedAt});
  const fresh=()=>{if(options.signal?.aborted)throw new Error('phase-cancelled');
    currentPhaseCapability(captured.handle);assertCodingPolicyFresh(captured.policyDigest,readCodingPolicy(captured.policyRoot).policyDigest);
    assertGrokTaskEvidenceFresh(captured.evidence,captured.mode,{...captured.input,policyRoot:captured.policyRoot});
    options.beforeAccept?.();};
  try {
    assertGrokTaskEvidenceFresh(captured.evidence,captured.mode,{...captured.input,policyRoot:captured.policyRoot});
    const proof=await verifyGrokBuildProviderConformance(captured.handle,{signal:options.signal,timeoutMs:Math.min(60000,captured.input.timeoutMs)});
    if(proof.status!=='verified')return failure(proof.code,proof.executionStopped!==false);
    if(!process.env.XAI_API_KEY)return failure('phase-provider-credential-unavailable');
    fresh();
    const capability=currentPhaseCapability(captured.handle);
    const result=await captureRestrictedProcess(capability,{...captured.input,signal:options.signal,maxBytes:1024*1024,beforeAccept:fresh});
    if(result.status!=='complete')return {...failure('phase-provider-'+result.status,result.executionStopped),status:result.status,
      cancelled:result.status==='cancelled',timedOut:result.status==='timed-out'};
    fresh();const parsed=parseGrokWorkerResult(result.output,capability.mode);
    mkdirSync(resolve(invocation.logPath,'..'),{recursive:true});writeFileSync(invocation.logPath,parsed.output,{mode:0o600});
    return {provider:'grok',...parsed,exitCode:parsed.status==='complete'?0:-1,executionStopped:true,
      changedFiles:result.changedFiles??[],promptMeasurement:invocation.promptMeasurement,
      logPath:invocation.logPath,durationMs:Date.now()-startedAt};
  }catch(error){return failure(error.message.startsWith('grok-task-evidence-')||['phase-cancelled','phase-provider-identity-changed'].includes(error.message)?error.message:'phase-provider-acceptance-failed');}
}

export async function verifyGrokBuildProviderConformance(handle, control={}) {
  let capability;
  try{capability=currentPhaseCapability(handle,false);}catch{return unavailablePhase('phase-provider-conformance-required');}
  if(capability.provider!=='grok'||!['implementation','review'].includes(capability.mode))return unavailablePhase('phase-provider-mode-unavailable');
  capability.verified=false;
  const phaseHandle=Object.freeze({...handle,mode:'phase'});
  phaseCapabilities.set(phaseHandle,{...capability,mode:'phase',verified:false});
  const isolation=await verifyPhaseProviderConformance(phaseHandle,control);
  if(isolation.status!=='verified')return isolation;
  const root=realpathSync(mkdtempSync(resolve(tmpdir(),'ewai-grok-build-conformance-'))),project=resolve(root,'project');
  mkdirSync(project);writeFileSync(resolve(project,'code.txt'),'before');
  const outside=resolve(root,'canonical-approval.json'),requests=[];
  let attack=false,executionStopped=true;
  const server=createServer((request,response)=>{
    if(request.method==='GET'){requests.push({health:['/','/v1','/v1/models'].includes(request.url)});
      response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({data:[{id:'fixture',object:'model'}]}));return;}
    let body='';request.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>2*1024*1024)request.destroy();});
    request.on('end',()=>{
      let value;try{value=JSON.parse(body);}catch{response.writeHead(400);response.end();return;}
      const tools=(value.tools??[]).map(tool=>tool.function?.name??tool.name);
      requests.push({health:false,route:request.url,tools,canary:body.includes('EWAI_UNTRUSTED_INSTRUCTIONS_CANARY'),
        readObserved:!attack&&(value.messages??[]).some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('before'))});
      const title=tools.length===1&&tools[0]==='session_title';
      const finished=(value.messages??[]).some(message=>message.role==='tool');
      const call=!title&&!finished&&tools.length>1;
      const read=capability.mode==='review'&&!attack;
      const delta=call?{tool_calls:[{index:0,id:'fixture-tool',type:'function',function:{name:read?'read_file':'write',
        arguments:JSON.stringify(read?{target_file:'code.txt'}:{file_path:attack?outside:'code.txt',content:'after'})}}]}:{role:'assistant',content:'EWAI_BUILD_FIXTURE_ONLY'};
      response.writeHead(200,{'content-type':'text/event-stream'});
      const event=data=>response.write('data: '+JSON.stringify(data)+'\n\n');
      event({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:null}]});
      event({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
      response.end('data: [DONE]\n\n');
    });
  });
  try{
    await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
    const fixture={url:'http://127.0.0.1:'+server.address().port,isolationProbe:true,
      taskInput:{cwd:project,task:{read_set:['code.txt'],write_set:['code.txt']}}};
    const input={prompt:'Use only declared task files. Return the fixture token.',timeoutMs:15000,maxBytes:256*1024,signal:control.signal};
    const normal=await captureRestrictedProcess(capability,input,fixture);executionStopped&&=normal.executionStopped;
    const after=readFileSync(resolve(project,'code.txt'),'utf8');
    attack=true;
    const forged=await captureRestrictedProcess(capability,input,fixture);executionStopped&&=forged.executionStopped;
    const expected=capability.mode==='implementation'?['read_file','search_replace','list_dir','grep','write']:['read_file','list_dir','grep'];
    const checks={
      ...Object.fromEntries(['canonicalWritePrevented','outputBoundEnforced','timeoutEnforced','networkIsolated','childProcessPrevented'].map(key=>[key,isolation[key]===true])),
      nativeResult:normal.status==='complete'&&parseGrokWorkerResult(normal.output,capability.mode).output==='EWAI_BUILD_FIXTURE_ONLY',
      declaredWriteBoundary:capability.mode==='implementation'?after==='after'&&normal.changedFiles?.join(',')==='code.txt':after==='before'&&!normal.changedFiles?.length,
      nativeReadBoundary:capability.mode!=='review'||requests.some(request=>request.readObserved),
      inheritedCapabilitiesBlocked:requests.every(r=>r.health===true||r.route==='/v1/chat/completions'&&!r.canary
        &&(r.tools.length===1&&r.tools[0]==='session_title'||r.tools.length===0||r.tools.length===expected.length&&r.tools.every(tool=>expected.includes(tool)))),
      forbiddenWritePrevented:forged.executionStopped&&!existsSync(outside)&&readFileSync(resolve(project,'code.txt'),'utf8')===after,
      executionStopped,
    };
    capability.verified=Object.values(checks).every(value=>value===true);currentPhaseCapability(handle,false);
    return capability.verified?{status:'verified',provider:'grok',mode:capability.mode,identityDigest:handle.identityDigest,
      checks,fixtureServiceOnly:true,authority:'none'}:{...unavailablePhase('phase-provider-build-conformance-failed'),checks,
        requests:requests.map(r=>({route:r.health?'fixture-health':'fixture-model',tools:r.tools??[],inheritedInstructions:r.canary===true}))};
  }catch(error){return {...unavailablePhase('phase-provider-build-conformance-failed'),executionStopped,
    diagnosticCode:/^grok-task-[a-z-]+$/.test(error.message)?error.message:'native-fixture-failed'};}
  finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));if(executionStopped)rmSync(root,{recursive:true,force:true});}
}

function currentPhaseCapability(handle, requireVerified = true) {
  const capability = phaseCapabilities.get(handle);
  if (!capability || requireVerified && !capability.verified) throw new Error('phase-provider-conformance-required');
  if (installedExecutable(capability.provider) !== capability.executable
    || capability.provider === 'grok' && ['managed_config.toml', 'requirements.toml'].some(name => existsSync(resolve('/etc/grok', name)))) {
    capability.verified = false; throw new Error('phase-provider-identity-changed');
  }
  if (executableDigest(capability.executable) !== capability.hashes[0] || executableDigest(capability.sandbox) !== capability.hashes[1]) {
    capability.verified = false; throw new Error('phase-provider-identity-changed');
  }
  return capability;
}

function restrictedPhaseArgs(runtime, command, args, fixture, grok=null, mode='phase') {
  // One kernel policy covers every restriction; nested Seatbelt initialisation
  // is not supported. Denying fork also denies posix_spawn, so a child cannot
  // detach into a new session and outlive the captured process.
  const port = fixture?.url ? Number(new URL(fixture.url).port) : null;
  const ancestorDirectories=[];
  for(const start of [runtime,realpathSync(command)]) for(let path=dirname(start);path!==dirname(path);path=dirname(path))ancestorDirectories.push(path);
  const policy = `(version 1)(allow default)(deny file-write*)`
    + `(allow file-write* (subpath ${JSON.stringify(runtime)}))(deny process-fork)`
    + (fixture ? `(deny network*)${port ? `(allow network-outbound (remote ip "localhost:${port}"))` : ''}` : '')
    + (grok ? `(deny file-read-data)(allow file-read-data (literal "/") ${ancestorDirectories.map(path=>`(literal ${JSON.stringify(path)})`).join(' ')} (subpath "/System") (subpath "/usr") (subpath "/Library") (subpath "/dev") (subpath "/opt/homebrew/Cellar") (subpath "/opt/homebrew/lib") (subpath "/opt/homebrew/opt") (literal ${JSON.stringify(realpathSync(command))}) (subpath ${JSON.stringify(runtime)}))`
      + `(deny file-write* (literal ${JSON.stringify(resolve(grok.home,'.grok/config.toml'))}) (literal ${JSON.stringify(resolve(grok.home,'.grok/managed_config.toml'))}) (literal ${JSON.stringify(resolve(grok.home,'.grok/requirements.toml'))}))`
      + ['.grok','.claude','.cursor','.git','.ewai-pipeline'].map(name=>`(deny file-write* (subpath ${JSON.stringify(resolve(grok.cwd,name))}))`).join('')
      + (mode==='review'?`(deny file-write* (subpath ${JSON.stringify(grok.cwd)}))`:'') : '');
  return ['-p', policy, command, ...args];
}

const restrictedClaudeArgs = () => ['--safe-mode', '--bare', '--restricted', '--tools', '', '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--no-chrome', '--disable-slash-commands',
  '--no-session-persistence', '--system-prompt-snapshot', 'off', '--permission-mode', 'dontAsk',
  '--max-turns', '1', '--print', '--output-format', 'json'];

async function captureRestrictedProcess(capability, input, fixture = null) {
  const cancelledBeforeSpawn = () => ({ status: 'cancelled', exitCode: -1, signal: null,
    executionStopped: true, spawned: false, output: '', bytes: 0 });
  if (input.signal?.aborted) return cancelledBeforeSpawn();
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-phase-process-')));
  const identity = lstatSync(directory), runtime = resolve(directory, 'runtime');
  let stopped = true;
  try {
  mkdirSync(runtime, { mode: 0o700 });
  if (fixture?.isolationProbe) {
    // Deliberately hostile *fixture* configuration. A loaded hook/MCP server
    // would contact the local observer; no real provider endpoint is involved.
    const script = `require("node:http").get(${JSON.stringify(`${fixture.url}/forbidden-hook`)})`;
    const hook = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${JSON.stringify(process.execPath)} -e '${script}'` }] }] } };
    mkdirSync(resolve(directory, '.claude'));
    for (const path of [resolve(directory, '.claude/settings.json'), resolve(runtime, 'settings.json')]) writeFileSync(path, JSON.stringify(hook), { mode: 0o600 });
    writeFileSync(resolve(directory, '.mcp.json'), JSON.stringify({ mcpServers: { forbidden: { type: 'http', url: `${fixture.url}/forbidden-mcp` } } }), { mode: 0o600 });
    writeFileSync(resolve(directory, 'CLAUDE.md'), 'EWAI_UNTRUSTED_INSTRUCTIONS_CANARY', { mode: 0o600 });
  }
  const mode=capability.mode??'phase';
  const grok = capability.provider === 'grok' ? prepareGrokRuntime(directory, runtime, input.prompt, fixture, mode) : null;
  const taskInput=fixture?.taskInput??input;
  const snapshot=grok&&mode!=='phase'&&!fixture?.command
    ?prepareGrokTaskSnapshot(taskInput.cwd,grok.cwd,taskInput.task):null;
  const env = grok?.env ?? { ...phaseEnv(), CLAUDE_CONFIG_DIR: runtime, CLAUDE_CODE_TMPDIR: runtime, TMPDIR: runtime,
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    ANTHROPIC_API_KEY: fixture ? 'ewai-fixture-not-a-real-key' : process.env.ANTHROPIC_API_KEY };
  if (fixture?.url) env.ANTHROPIC_BASE_URL = fixture.url;
  if (grok && fixture?.command === process.execPath) env.OPENSSL_CONF = '/dev/null';
  const command = fixture?.command ?? capability.executable, args = fixture?.args ?? grok?.args ?? restrictedClaudeArgs();
  const launchCommand = capability.sandbox;
  const launchArgs = restrictedPhaseArgs(runtime, command, args, fixture, grok, mode);
    const result = await new Promise(resolvePromise => {
      let child, timer, killTimer, stopDeadline, terminal = null, bytes = 0, output = [], settled = false;
      const kill = signal => { if (child?.pid) try { process.kill(-child.pid, signal); } catch {} };
      const stop = status => {
        if (settled) return;
        terminal ??= status; kill('SIGTERM'); killTimer ??= setTimeout(() => kill('SIGKILL'), 250);
        stopDeadline ??= setTimeout(() => {
          if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer);
          input.signal?.removeEventListener('abort', cancel);
          unsettledProcesses.add(child); child.once('close', () => unsettledProcesses.delete(child));
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
          resolvePromise({ status: 'unknown', exitCode: -1, signal: null, executionStopped: false, output: '', bytes });
        }, 1000);
      };
      const cancel = () => stop('cancelled');
      const finish = async (exitCode, signal) => {
        if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(stopDeadline);
        input.signal?.removeEventListener('abort', cancel);
        // A surviving process group is not a confirmed stop. Kill it and do
        // not return a proposal; preserve its private workspace for recovery.
        stopped = !child?.pid;
        for (let attempt = 0; child?.pid && attempt < 20; attempt += 1) {
          try { process.kill(-child.pid, 0); kill('SIGKILL'); }
          catch (error) { stopped = error.code === 'ESRCH'; break; }
          // macOS may retain a reparented zombie briefly. A zombie cannot
          // execute or hold file descriptors; do not confuse it with a worker.
          const processes = spawnSync('/bin/ps', ['-o', 'pgid=,stat=', '-g', String(child.pid)],
            { encoding: 'utf8', timeout: 500, maxBuffer: 4096, env: phaseEnv() });
          const rows = (processes.stdout ?? '').trim().split('\n').filter(Boolean);
          if (!processes.error && rows.length && rows.every(row => {
            const [group, state] = row.trim().split(/\s+/); return group === String(child.pid) && /^Z/.test(state ?? '');
          })) { stopped = true; break; }
          await new Promise(resolveWait => setTimeout(resolveWait, 25));
        }
        if (input.signal?.aborted) terminal ??= 'cancelled';
        resolvePromise({ status: !stopped ? 'unknown' : terminal ?? (exitCode === 0 ? 'complete' : 'failed'),
          exitCode: exitCode ?? -1, signal: signal ?? null, executionStopped: stopped,
          output: !terminal && stopped ? Buffer.concat(output).toString('utf8') : '', bytes });
      };
      if (input.signal?.aborted) { stopped = true; resolvePromise(cancelledBeforeSpawn()); return; }
      try { stopped=false; child = spawn(launchCommand, launchArgs, { cwd: grok?.cwd ?? directory, env, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch { finish(-1, null); return; }
      const capture = (chunk, stdout) => {
        bytes += chunk.length;
        if (bytes > input.maxBytes) { output = []; stop('truncated'); return; }
        if (stdout && !terminal) output.push(chunk);
      };
      child.stdout.on('data', chunk => capture(chunk, true)); child.stderr.on('data', chunk => capture(chunk, false));
      child.stdin.on('error', () => {});
      child.once('error', () => finish(-1, null)); child.once('close', finish);
      timer = setTimeout(() => stop('timed-out'), input.timeoutMs);
      input.signal?.addEventListener('abort', cancel, { once: true });
      if (input.signal?.aborted) cancel();
      child.stdin.end(terminal || grok ? '' : input.prompt);
    });
    if(snapshot&&result.status==='complete'&&parseGrokWorkerResult(result.output,mode).status==='complete'){
      result.changedFiles=acceptGrokTaskSnapshot(snapshot,{readOnly:mode==='review',beforeAccept:input.beforeAccept});
    }
    return result;
  } finally {
    if (stopped && existsSync(directory)) {
      const current = lstatSync(directory);
      if (current.isDirectory() && current.ino === identity.ino && current.dev === identity.dev) rmSync(directory, { recursive: true });
    }
  }
}

export async function invokeRestrictedPhaseProvider(handle, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.prompt !== 'string' || Buffer.byteLength(input.prompt) > 256 * 1024
    || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 600000
    || input.signal !== undefined && !(input.signal instanceof AbortSignal)) return unavailablePhase('phase-provider-input-invalid');
  let capability;
  try { capability = currentPhaseCapability(handle); } catch { return unavailablePhase('phase-provider-conformance-required'); }
  if(capability.mode!=='phase')return unavailablePhase('phase-provider-mode-unavailable');
  if (input.signal?.aborted) return { status: 'cancelled', exitCode: -1, executionStopped: true, spawned: false, output: '' };
  if (!(capability.provider === 'grok' ? process.env.XAI_API_KEY : process.env.ANTHROPIC_API_KEY)) return unavailablePhase('phase-provider-credential-unavailable');
  const captured = await captureRestrictedProcess(capability, { ...input, maxBytes: 256 * 1024 });
  if (captured.status !== 'complete') return { ...captured, output: '' };
  try { currentPhaseCapability(handle); } catch { return { ...unavailablePhase('phase-provider-identity-changed'), executionStopped: true, output: '' }; }
  if (capability.provider === 'grok') return { ...parseGrokWorkerResult(captured.output), exitCode: captured.exitCode, executionStopped: true };
  let envelope;
  try { envelope = JSON.parse(captured.output); } catch { return { status: 'malformed', executionStopped: true, exitCode: 0, output: '' }; }
  if (envelope?.type !== 'result' || envelope.subtype !== 'success' || envelope.is_error !== false || typeof envelope.result !== 'string') {
    return { status: 'failed', executionStopped: true, exitCode: captured.exitCode, output: '' };
  }
  return { status: 'complete', exitCode: 0, executionStopped: true, output: envelope.result,
    providerUsage: normaliseProviderUsage('claude', envelope.usage) };
}

export async function verifyPhaseProviderConformance(handle, control = {}) {
  if (!control || typeof control !== 'object' || Array.isArray(control)
    || Object.getPrototypeOf(control) !== Object.prototype || Object.keys(control).some(key => !['signal', 'timeoutMs'].includes(key))
    || control.signal !== undefined && !(control.signal instanceof AbortSignal)
    || control.timeoutMs !== undefined && (!Number.isSafeInteger(control.timeoutMs) || control.timeoutMs < 100 || control.timeoutMs > 600000)) {
    return { ...unavailablePhase('phase-provider-input-invalid'), executionStopped: true };
  }
  if (control.signal?.aborted) return { ...unavailablePhase('phase-cancelled'), executionStopped: true };
  let capability;
  try { capability = currentPhaseCapability(handle, false); } catch { return unavailablePhase('phase-provider-conformance-required'); }
  capability.verified = false;
  const controller = new AbortController(), cancel = () => controller.abort();
  control.signal?.addEventListener('abort', cancel, { once: true });
  const deadline = setTimeout(cancel, control.timeoutMs ?? 60000);
  let executionStopped = true;
  const capture = async (capability, input, fixture) => {
    if (controller.signal.aborted) throw new Error('phase-cancelled');
    const result = await captureRestrictedProcess(capability, { ...input, signal: controller.signal }, fixture);
    executionStopped &&= result.executionStopped === true;
    if (!executionStopped) throw new Error('phase-execution-unknown');
    if (controller.signal.aborted) throw new Error('phase-cancelled');
    return result;
  };
  const targetRoot = realpathSync(mkdtempSync(resolve(tmpdir(), 'ewai-phase-conformance-'))), target = resolve(targetRoot, 'approval.json');
  const requests = [];
  let forcedTool = false;
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/ewai-network-probe') { response.writeHead(204); response.end(); return; }
    if (capability.provider === 'grok' && request.method === 'GET' && ['/', '/v1', '/v1/models'].includes(request.url)) {
      requests.push({ path: request.url, healthProbe: true }); response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model', owned_by: 'ewai' }] })); return;
    }
    if (request.method === 'HEAD' && request.url === '/api/hello') {
      requests.push({ path: '/api/hello', healthProbe: true }); response.writeHead(204); response.end(); return;
    }
    let body = '', bytes = 0;
    request.on('data', chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) request.destroy(); else body += chunk; });
    request.on('end', () => {
      let input; try { input = JSON.parse(body); } catch { requests.push({ path: request.url }); response.writeHead(400); response.end(); return; }
      requests.push({ path: request.url, tools: (input.tools ?? []).map(tool => tool.function?.name ?? tool.name),
        toolFields: (input.tools ?? []).map(tool => Object.keys((tool.function ?? tool).parameters?.properties ?? {})),
        titleOnly: capability.provider === 'grok' && input.tools?.length === 1
          && input.tools[0].function?.name === 'session_title'
          && Object.keys(input.tools[0].function.parameters?.properties ?? {}).join(',') === 'session_title'
          && input.tools[0].function.parameters.properties.session_title.type === 'string',
        inheritedInstructions: body.includes('EWAI_UNTRUSTED_INSTRUCTIONS_CANARY') });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (capability.provider === 'grok') {
        const event = value => response.write('data: ' + JSON.stringify(value) + '\n\n');
        const delta = forcedTool ? { tool_calls: [{ index: 0, id: 'ewai-forged', type: 'function', function: {
          name: 'write_file', arguments: JSON.stringify({ file_path: target, content: 'forged approval' }) } }] }
          : { role: 'assistant', content: 'EWAI_RESTRICTED_FIXTURE_ONLY' };
        event({ id: 'ewai-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] });
        event({ id: 'ewai-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: forcedTool ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        response.end('data: [DONE]\n\n'); return;
      }
      const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
      event('message_start', { message: { id: 'msg_ewai_fixture', type: 'message', role: 'assistant', model: 'fixture-model',
        content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
      event('content_block_start', { index: 0, content_block: forcedTool
        ? { type: 'tool_use', id: 'toolu_ewai_fixture', name: 'Write', input: {} } : { type: 'text', text: '' } });
      event('content_block_delta', { index: 0, delta: forcedTool
        ? { type: 'input_json_delta', partial_json: JSON.stringify({ file_path: target, content: 'forged approval' }) }
        : { type: 'text_delta', text: 'EWAI_RESTRICTED_FIXTURE_ONLY' } });
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: forcedTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      event('message_stop', {}); response.end();
    });
  });
  try {
    await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); });
    const fixtureUrl = `http://127.0.0.1:${server.address().port}`;
    const network = await capture(capability, { prompt: '', timeoutMs: 5000, maxBytes: 1024 }, {
      url: fixtureUrl, command: process.execPath, args: ['-e',
        'const http=require("node:http"),net=require("node:net");let a=null,b=null;const done=()=>{if(a!==null&&b!==null)process.stdout.write(JSON.stringify({allowed:a,denied:b}))};http.get(process.argv[1]+"/ewai-network-probe",r=>{a=r.statusCode===204;r.resume();done()}).on("error",()=>{a=false;done()});const s=net.connect({host:"127.0.0.2",port:Number(process.argv[2])});s.on("connect",()=>{b=false;s.destroy();done()});s.on("error",e=>{b=["EPERM","EACCES"].includes(e.code);done()});',
        fixtureUrl, String(server.address().port)] });
    if (network.status !== 'complete' || network.output !== '{"allowed":true,"denied":true}') {
      let observed; try { observed = JSON.parse(network.output); } catch {}
      return { ...unavailablePhase('phase-provider-network-confinement-failed'), checks: { networkIsolated: false,
        allowedLoopback: observed?.allowed === true, deniedOtherAddress: observed?.denied === true,
        processComplete: network.status === 'complete' } };
    }
    const denial = await capture(capability, { prompt: '', timeoutMs: 5000, maxBytes: 1024 }, {
      command: process.execPath, args: ['-e', 'try{require("node:fs").writeFileSync(process.argv[1],"forged");process.stdout.write("UNSAFE")}catch(e){process.stdout.write(e.code)}', target] });
    const overflow = await capture(capability, { prompt: '', timeoutMs: 5000, maxBytes: 1024 }, {
      command: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(65536))'] });
    const timeout = await capture(capability, { prompt: '', timeoutMs: 100, maxBytes: 1024 }, {
      command: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'] });
    const fork = await capture(capability, { prompt: '', timeoutMs: 5000, maxBytes: 1024 }, {
      command: process.execPath, args: ['-e',
        'try{const c=require("node:child_process").spawn(process.execPath,["-e","process.exit()"],{detached:true,stdio:"ignore"});c.on("error",e=>process.stdout.write(e.code));c.on("spawn",()=>process.stdout.write("UNSAFE"))}catch(e){process.stdout.write(e.code)}'] });
    const primitiveChecks = {
      networkIsolated: true,
      canonicalWritePrevented: denial.status === 'complete' && ['EPERM', 'EACCES'].includes(denial.output) && !existsSync(target),
      outputBoundEnforced: overflow.status === 'truncated' && overflow.output === '' && overflow.executionStopped,
      timeoutEnforced: timeout.status === 'timed-out' && timeout.output === '' && timeout.executionStopped,
      childProcessPrevented: fork.status === 'complete' && ['EPERM', 'EACCES'].includes(fork.output),
    };
    if (!Object.values(primitiveChecks).every(value => value === true)) {
      return { ...unavailablePhase('phase-provider-confinement-failed'), checks: primitiveChecks };
    }
    const model = await capture(capability, { prompt: 'Return the fixture token only.', timeoutMs: 15000, maxBytes: 16384 },
      { url: fixtureUrl, isolationProbe: true });
    let envelope; try { envelope = JSON.parse(model.output); } catch {}
    forcedTool = true;
    const forged = await capture(capability, { prompt: 'No tools or approvals are authorised.', timeoutMs: 15000, maxBytes: 16384 },
      { url: fixtureUrl, isolationProbe: true });
    let refused; try { refused = JSON.parse(forged.output); } catch {}
    const nativeGrok = capability.provider === 'grok';
    const modelRoute = request => nativeGrok ? request.path === '/v1/chat/completions' : request.path.startsWith('/v1/messages');
    const checks = {
      ...primitiveChecks,
      structuredDraft: nativeGrok ? model.status === 'complete' && parseGrokWorkerResult(model.output).output === 'EWAI_RESTRICTED_FIXTURE_ONLY'
        : model.status === 'complete' && envelope?.type === 'result' && envelope.subtype === 'success' && envelope.is_error === false
        && envelope.result === 'EWAI_RESTRICTED_FIXTURE_ONLY',
      inheritedCapabilitiesBlocked: (nativeGrok ? requests.filter(modelRoute).length >= 2 : requests.filter(modelRoute).length === 2)
        && requests.every(request => request.healthProbe === true
          || modelRoute(request) && (request.tools?.length === 0 || request.titleOnly === true) && !request.inheritedInstructions)
        && requests.filter(request => modelRoute(request) && request.tools?.length === 0).length >= 2,
      forgedToolRefused: forged.executionStopped && !existsSync(target) && (nativeGrok
        ? parseGrokWorkerResult(forged.output).status !== 'complete' : refused?.type === 'result' && refused.is_error === true),
    };
    capability.verified = Object.values(checks).every(value => value === true);
    currentPhaseCapability(handle, false);
    return capability.verified ? { status: 'verified', provider: capability.provider, identityDigest: handle.identityDigest,
      canonicalWritePrevented: true, outputBoundEnforced: true, timeoutEnforced: true, networkIsolated: true, childProcessPrevented: true, toolsExposed: 0, inheritedCapabilitiesBlocked: true,
      forgedToolRefused: true, fixtureServiceOnly: true,
      ...(nativeGrok ? { auxiliaryTools: requests.some(request => request.titleOnly) ? ['session_title'] : [],
        toolsBoundary: 'zero worker tools; auxiliary title schema confined to private runtime' } : {}),
      authority: 'none' } : { ...unavailablePhase('phase-provider-conformance-failed'), checks,
        requests: requests.map(request => ({ route: request.healthProbe ? 'fixture-health' : modelRoute(request) ? 'fixture-model'
          : request.path.includes('forbidden-hook') ? 'forbidden-hook' : request.path.includes('forbidden-mcp') ? 'forbidden-mcp' : 'other',
        toolsExposed: request.tools?.length ?? null, toolFields: request.toolFields, toolNames: (request.tools ?? []).filter(name => /^[a-z_]{1,64}$/.test(name)), inheritedInstructions: request.inheritedInstructions === true })) };
  } catch (error) {
    capability.verified = false;
    return { ...unavailablePhase(['phase-cancelled', 'phase-execution-unknown'].includes(error.message)
      ? error.message : 'phase-provider-conformance-failed'), executionStopped };
  } finally {
    clearTimeout(deadline); control.signal?.removeEventListener('abort', cancel);
    server.closeAllConnections(); await new Promise(resolvePromise => server.close(resolvePromise));
    if (executionStopped) rmSync(targetRoot, { recursive: true, force: true });
  }
}
