import {constants,openSync,closeSync,fstatSync,lstatSync,readFileSync,writeFileSync,renameSync,unlinkSync,realpathSync,fsyncSync,existsSync} from 'node:fs';
import {dirname,relative,resolve,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import YAML from 'yaml';
import {projectPaths} from './paths.mjs';

function fail(message,statusCode=409){const error=new Error(message);error.statusCode=statusCode;error.configurationError=true;throw error;}
function safePath(paths){
  const root=realpathSync(paths.projectRoot),parent=dirname(paths.configPath),rel=relative(root,realpathSync(parent));
  if(rel.startsWith('..')||isAbsolute(rel))fail('Settings require a safe project configuration path.',403);
  let cursor=parent;
  while(cursor!==paths.projectRoot){if(lstatSync(cursor).isSymbolicLink())fail('Settings cannot use a symbolic configuration directory.',403);const next=dirname(cursor);if(next===cursor)fail('Settings require a safe project configuration path.',403);cursor=next;}
  const stat=lstatSync(paths.configPath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('Settings require a regular, non-symbolic configuration file.',403);
  if(stat.size>2*1024*1024)fail('The project configuration is too large for settings editing.',413);
  return stat;
}
export function readProjectDocument(projectRoot){
  const paths=projectPaths(projectRoot);let fd;
  try{
    const stat=safePath(paths);fd=openSync(paths.configPath,constants.O_RDONLY|constants.O_NOFOLLOW);
    const opened=fstatSync(fd);if(opened.ino!==stat.ino||opened.dev!==stat.dev)fail('Project configuration changed. Reload the settings and try again.');
    const bytes=readFileSync(fd);if(bytes.length>2*1024*1024)fail('The project configuration is too large for settings editing.',413);
    const document=YAML.parseDocument(bytes.toString('utf8'));
    if(document.errors.length)fail('Project configuration contains invalid YAML. Fix it before editing settings.',422);
    let config;try{config=document.toJS({maxAliasCount:100});}catch{fail('The project configuration cannot be safely read.',422);}
    if(config?.schema!=='ewai.project/v1'||config?.specs?.root!==paths.specsRelative)fail('Project configuration and SPECS locator must agree before editing settings.',422);
    return {paths,document,config,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),mode:stat.mode&0o777};
  }catch(error){if(error.configurationError)throw error;fail('Project settings could not be read. Check configuration and file permissions.');}
  finally{if(fd!==undefined)closeSync(fd);}
}
export function editProjectDocument(projectRoot,expectedDigest,apply){
  if(!/^sha256:[a-f0-9]{64}$/.test(String(expectedDigest??'')))fail('Reload settings before saving.',400);
  const paths=projectPaths(projectRoot),lock=paths.configPath+'.configuration.lock';let lockFd,tempFd,temporary;
  try{
    safePath(paths);
    if(existsSync(paths.configPath+'.dashboard-preferences.lock'))fail('Settings are being edited. Retry after that save finishes.');
    try{lockFd=openSync(lock,'wx',0o600);}catch{fail('Settings are being edited. Retry after that save finishes.');}
    const before=readProjectDocument(projectRoot);if(before.digest!==expectedDigest)fail('Project configuration changed. Reload the settings and try again.');
    apply(before.document,before.config);
    const content=before.document.toString();
    temporary=paths.configPath+'.settings-'+randomUUID()+'.tmp';tempFd=openSync(temporary,'wx',before.mode);
    writeFileSync(tempFd,content,'utf8');fsyncSync(tempFd);closeSync(tempFd);tempFd=undefined;
    if(readProjectDocument(projectRoot).digest!==before.digest)fail('Project configuration changed. Reload the settings and try again.');
    safePath(paths);renameSync(temporary,paths.configPath);temporary=undefined;
    return readProjectDocument(projectRoot);
  }catch(error){if(error.configurationError||error.codingProviderError||error.dashboardPreferenceError)throw error;fail('Project settings could not be saved. Check configuration and file permissions.');}
  finally{if(tempFd!==undefined)closeSync(tempFd);if(temporary)unlinkSync(temporary);if(lockFd!==undefined){closeSync(lockFd);unlinkSync(lock);}}
}
