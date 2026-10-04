import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, openSync, closeSync, fstatSync, constants, renameSync, unlinkSync, fsyncSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {parse as parseToml} from 'smol-toml';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';

const codexStart = '# EWAI-MCP:START';
const codexEnd = '# EWAI-MCP:END';

function writeJsonConfig(path, apply) {
  let config = {};
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (existsSync(path)) {
    try {
      config = JSON.parse(existing);
    } catch (error) {
      throw new Error(`Cannot safely update invalid JSON configuration ${path}: ${error.message}`);
    }
  }
  const before = JSON.stringify(config);
  apply(config);
  if (existing !== null && JSON.stringify(config) === before) return path;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return path;
}

function stdioDefinition(includeType = false) {
  return {
    ...(includeType ? { type: 'stdio' } : {}),
    command: 'ewai',
    args: ['mcp', '--project', '.']
  };
}

function configureClaude(projectRoot) {
  return writeJsonConfig(resolve(projectRoot, '.mcp.json'), (config) => {
    config.mcpServers ??= {};
    config.mcpServers.ewai = stdioDefinition(true);
  });
}

function configureClaudeSessionStart(projectRoot) {
  return writeJsonConfig(resolve(projectRoot, '.claude/settings.json'), (config) => {
    config.hooks ??= {};
    const managed = {
      matcher: 'startup|resume|clear|compact',
      hooks: [{
        type: 'command',
        command: 'ewai checkin --project . --json',
        timeout: 30,
        statusMessage: 'Opening the EWAI project companion…'
      }]
    };
    const existing = Array.isArray(config.hooks.SessionStart) ? config.hooks.SessionStart : [];
    const command = managed.hooks[0].command;
    const retained = existing
      .map((entry) => {
        if (!Array.isArray(entry?.hooks)) return entry;
        const hooks = entry.hooks.filter((hook) => hook?.command !== command);
        if (hooks.length === entry.hooks.length) return entry;
        return hooks.length ? { ...entry, hooks } : null;
      })
      .filter(Boolean);
    config.hooks.SessionStart = [
      ...retained,
      managed
    ];
  });
}

function configureAntigravity(projectRoot) {
  return writeJsonConfig(resolve(projectRoot, '.agents/mcp_config.json'), (config) => {
    config.mcpServers ??= {};
    config.mcpServers.ewai = stdioDefinition();
  });
}

function configureCodex(projectRoot) {
  const path = resolve(projectRoot, '.codex/config.toml');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const withoutManaged = existing.includes(codexStart) && existing.includes(codexEnd)
    ? `${existing.slice(0, existing.indexOf(codexStart))}${existing.slice(existing.indexOf(codexEnd) + codexEnd.length)}`.trim()
    : existing.trim();
  const managed = `${codexStart}
[mcp_servers.ewai]
command = "ewai"
args = ["mcp", "--project", "."]
cwd = "."
startup_timeout_sec = 20
default_tools_approval_mode = "writes"
${codexEnd}`;
  const updated = `${withoutManaged ? `${withoutManaged}\n\n` : ''}${managed}\n`;
  if (updated === existing) return path;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, updated, 'utf8');
  return path;
}

function grokError(message){throw new Error('Cannot safely configure Grok MCP: '+message);}
function grokPath(root,path){
  let cursor=dirname(path);
  while(cursor!==root){if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())grokError('symbolic configuration directories are unsupported.');const next=dirname(cursor);if(next===cursor)grokError('configuration must remain inside the project.');cursor=next;}
  if(existsSync(path)){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)grokError('use a regular, non-symbolic configuration file.');if(stat.size>2*1024*1024)grokError('configuration exceeds the safe size limit.');}
  else{try{lstatSync(path);grokError('a symbolic configuration target is unsupported.');}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function grokToml(text){try{return parseToml(text,{integersAsBigInt:'as-needed'});}catch{grokError('invalid TOML; fix it before enabling EWAI.');}}
function configureGrok(root){
  const path=resolve(root,'.grok/config.toml');grokPath(root,path);let fd,original='';
  if(existsSync(path)){try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);if(stat.nlink!==1||stat.size>2*1024*1024)grokError('unsafe configuration file.');original=readFileSync(fd,'utf8');}finally{if(fd!==undefined)closeSync(fd);}}
  const parsed=grokToml(original),starts=[...original.matchAll(/^# EWAI-MCP:START\r?$/gm)],ends=[...original.matchAll(/^# EWAI-MCP:END\r?$/gm)];
  if(starts.length!==ends.length||starts.length>1||(starts.length&&starts[0].index>=ends[0].index))grokError('ambiguous managed markers; correct them without losing existing settings.');
  let retained=original;
  if(starts.length){const start=starts[0].index,end=ends[0].index+ends[0][0].length;retained=original.slice(0,start)+original.slice(end).replace(/^\r?\n/,'');
    const rest=grokToml(retained),before=parsed;if(!before.mcp_servers?.ewai)grokError('markers do not identify an owned MCP entry.');delete before.mcp_servers.ewai;if(!Object.keys(before.mcp_servers).length)delete before.mcp_servers;
    if(!isDeepStrictEqual(rest,before))grokError('managed markers overlap unrelated configuration.');
  }else if(parsed.mcp_servers?.ewai)grokError('an unmanaged ewai entry already exists; review it before enabling EWAI.');
  const newline=original.includes('\r\n')?'\r\n':'\n';
  const managed=[codexStart,'[mcp_servers.ewai]','command = "ewai"','args = ["mcp", "--project", "."]','cwd = "."',codexEnd,''].join(newline);
  const updated=retained+(retained&&!retained.endsWith('\n')?newline:'')+managed;grokToml(updated);
  if(updated===original)return path;
  mkdirSync(dirname(path),{recursive:true});const temporary=path+'.ewai-'+randomUUID()+'.tmp';let tempFd;
  try{grokPath(root,path);if((existsSync(path)?readFileSync(path,'utf8'):'')!==original)grokError('configuration changed; retry after reviewing the latest settings.');tempFd=openSync(temporary,'wx',existsSync(path)?lstatSync(path).mode&0o777:0o600);writeFileSync(tempFd,updated,'utf8');fsyncSync(tempFd);closeSync(tempFd);tempFd=undefined;grokPath(root,path);if((existsSync(path)?readFileSync(path,'utf8'):'')!==original)grokError('configuration changed; retry after reviewing the latest settings.');renameSync(temporary,path);}finally{if(tempFd!==undefined)closeSync(tempFd);if(existsSync(temporary))unlinkSync(temporary);}
  return path;
}

export function configureProjectMcp(projectRoot) {
  const root = resolve(projectRoot);
  const grok=configureGrok(root);
  return {
    schema: 'ewai.mcp-configuration/v1',
    transport: 'stdio',
    command: 'ewai mcp --project .',
    hosts: {
      codex: configureCodex(root),
      claude: configureClaude(root),
      antigravity: configureAntigravity(root),
      grok
    },
    hooks: { claude: configureClaudeSessionStart(root) }
  };
}
