import {constants,openSync,closeSync,fstatSync,lstatSync,readFileSync,writeFileSync,renameSync,unlinkSync,realpathSync,fsyncSync} from 'node:fs';
import {dirname,relative,resolve,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import YAML from 'yaml';
import {projectPaths} from './paths.mjs';

export const DASHBOARD_VIEWS=Object.freeze([
  ['portfolio','Portfolio','Compare work and decisions across several projects.','Across projects and teams'],
  ['team-hub','Team Hub','Share approved resources and project summaries with your team.','Across projects and teams'],
  ['rollout','Governed Rollout','Coordinate adoption across organisations or multiple projects.','Across projects and teams'],
  ['starters','Starters','Inspect and deliberately apply approved starting material.','Project tools'],
  ['policies','Policy Gates','Inspect organisation policy requirements and their evidence.','Project tools'],
  ['security','Security Validation','Review configured security checks, findings and decisions.','Project tools'],
  ['hooks','Hooks','Inspect explicitly configured lifecycle integrations and failures.','Project tools'],
  ['context-inspector','AI context diagnostics','See which evidence and personas EWAI selects for an AI task.','Deeper analysis'],
  ['phase-studio','Contributions','Add attributed business or technical evidence to an active delivery.','Deeper analysis'],
].map(([id,title,description,group])=>Object.freeze({id,title,description,group})));

function fail(message,statusCode=400){const error=new Error(message);error.statusCode=statusCode;error.dashboardPreferenceError=true;throw error;}
function record(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function keys(value,allowed){if(!record(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('Dashboard preferences contain unsupported fields.');}
export function normaliseDashboardPreferences(value={}){
  keys(value,['optional_views','sidebar_collapsed']);
  const optional=value.optional_views===undefined?{}:value.optional_views;keys(optional,DASHBOARD_VIEWS.map(v=>v.id));
  if(value.sidebar_collapsed!==undefined&&typeof value.sidebar_collapsed!=='boolean')fail('Sidebar preferences must be true or false.');
  for(const flag of Object.values(optional))if(typeof flag!=='boolean')fail('Dashboard view preferences must be true or false.');
  return {sidebar_collapsed:value.sidebar_collapsed??false,optional_views:Object.fromEntries(DASHBOARD_VIEWS.map(v=>[v.id,optional[v.id]??false]))};
}
export function premiumPersonasActive(premium){return premium?.access==='available'&&premium?.installed===true&&premium?.verified===true;}
const digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
function safePath(paths){
  const root=realpathSync(paths.projectRoot),parent=dirname(paths.configPath),rel=relative(root,realpathSync(parent));
  if(rel.startsWith('..')||isAbsolute(rel))fail('Dashboard preferences require a safe project configuration path.',403);
  let cursor=parent;
  while(cursor!==paths.projectRoot){if(lstatSync(cursor).isSymbolicLink())fail('Dashboard preferences cannot use a symbolic configuration directory.',403);const next=dirname(cursor);if(next===cursor)fail('Dashboard preferences require a safe project configuration path.',403);cursor=next;}
  const stat=lstatSync(paths.configPath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('Dashboard preferences require a regular, non-symbolic configuration file.',403);
  if(stat.size>2*1024*1024)fail('The project configuration is too large for dashboard preference editing.',413);
  return stat;
}
function snapshot(paths){
  const stat=safePath(paths);let fd;
  try{
    fd=openSync(paths.configPath,constants.O_RDONLY|constants.O_NOFOLLOW);
    const opened=fstatSync(fd);if(opened.ino!==stat.ino||opened.dev!==stat.dev)fail('Project configuration changed. Reload the settings and try again.',409);
    const bytes=readFileSync(fd);if(bytes.length>2*1024*1024)fail('The project configuration is too large for dashboard preference editing.',413);
    const document=YAML.parseDocument(bytes.toString('utf8'));
    if(document.errors.length)fail('The project configuration contains invalid YAML. Fix it before editing dashboard preferences.',422);
    let config;try{config=document.toJS({maxAliasCount:100});}catch{fail('The project configuration cannot be safely read.',422);}
    if(config?.schema!=='ewai.project/v1'||config?.specs?.root!==paths.specsRelative)fail('The project configuration and SPECS locator must agree before editing dashboard preferences.',422);
    return {document,preferences:normaliseDashboardPreferences(config.dashboard),digest:digest(bytes),mode:stat.mode&0o777};
  }finally{if(fd!==undefined)closeSync(fd);}
}
function guarded(operation){try{return operation();}catch(error){if(error.dashboardPreferenceError)throw error;fail('Dashboard preferences could not be read or saved. Check the project configuration and file permissions.',409);}}
function projection(state){return {schema:'ewai.dashboard-preferences/v1',digest:state.digest,preferences:state.preferences,views:DASHBOARD_VIEWS};}
export function readDashboardPreferences(projectRoot){return guarded(()=>projection(snapshot(projectPaths(projectRoot))));}
export function saveDashboardPreferences(projectRoot,input){
  return guarded(()=>{
    keys(input,['confirmed','expectedDigest','preferences']);
    if(input.confirmed!==true)fail('Confirm the dashboard preference changes before saving.');
    if(!/^sha256:[a-f0-9]{64}$/.test(String(input.expectedDigest??'')))fail('Reload dashboard preferences before saving.');
    if(!record(input.preferences))fail('Provide the dashboard preferences to save.');
    const preferences=normaliseDashboardPreferences(input.preferences),paths=projectPaths(projectRoot);
    safePath(paths);const lock=paths.configPath+'.dashboard-preferences.lock';let lockFd,tempFd,temporary;
    try{
      try{lockFd=openSync(lock,'wx',0o600);}catch{fail('Dashboard preferences are being edited. Retry after that save finishes.',409);}
      const before=snapshot(paths);if(before.digest!==input.expectedDigest)fail('Project configuration changed. Reload the settings and try again.',409);
      before.document.set('dashboard',preferences);const content=before.document.toString();
      temporary=paths.configPath+'.dashboard-'+randomUUID()+'.tmp';tempFd=openSync(temporary,'wx',before.mode);
      writeFileSync(tempFd,content,'utf8');fsyncSync(tempFd);closeSync(tempFd);tempFd=undefined;
      if(snapshot(paths).digest!==before.digest)fail('Project configuration changed. Reload the settings and try again.',409);
      safePath(paths);renameSync(temporary,paths.configPath);temporary=undefined;
      return projection(snapshot(paths));
    }finally{
      if(tempFd!==undefined)closeSync(tempFd);
      if(temporary)unlinkSync(temporary);
      if(lockFd!==undefined){closeSync(lockFd);unlinkSync(lock);}
    }
  });
}
