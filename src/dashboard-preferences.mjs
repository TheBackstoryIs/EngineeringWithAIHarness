import {readProjectDocument,editProjectDocument} from './config-document.mjs';

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
function snapshot(projectRoot){const state=readProjectDocument(projectRoot);return {...state,preferences:normaliseDashboardPreferences(state.config.dashboard)};}
function guarded(operation){try{return operation();}catch(error){if(error.dashboardPreferenceError||error.configurationError)throw error;fail('Dashboard preferences could not be read or saved. Check project configuration and file permissions.',409);}}
function projection(state){return {schema:'ewai.dashboard-preferences/v1',digest:state.digest,preferences:state.preferences,views:DASHBOARD_VIEWS};}
export function readDashboardPreferences(projectRoot){return guarded(()=>projection(snapshot(projectRoot)));}
export function saveDashboardPreferences(projectRoot,input){
  return guarded(()=>{
    keys(input,['confirmed','expectedDigest','preferences']);
    if(input.confirmed!==true)fail('Confirm the dashboard preference changes before saving.');
    if(!record(input.preferences))fail('Provide the dashboard preferences to save.');
    const preferences=normaliseDashboardPreferences(input.preferences);
    const state=editProjectDocument(projectRoot,input.expectedDigest,document=>document.set('dashboard',preferences));
    return projection({...state,preferences:normaliseDashboardPreferences(state.config.dashboard)});
  });
}
