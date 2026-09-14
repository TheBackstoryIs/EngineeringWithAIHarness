const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function optionalIcon(id){
  const paths={
    portfolio:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    'team-hub':'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 5a5 5 0 0 1 3 5"/>',
    rollout:'<path d="M5 19 19 5M5 5h14v14M5 12v7h7"/>',
    starters:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8m-9 5v9"/>',
    policies:'<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2m-6 7h6m-6 5h6"/>',
    security:'<path d="m12 2 9 4v6c0 5-4 8-9 10-5-2-9-5-9-10V6l9-4Zm-4 10 3 3 5-6"/>',
    hooks:'<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
    'context-inspector':'<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7M7 8h6m-6 4h4"/>',
    'phase-studio':'<path d="M21 11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8m2 1 3 3M10 16l4-1 8-8-3-3-8 8-1 4Z"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[id]??''}</svg>`;
}

export function createDashboardNavigation({api,onSelect,onManageLicence}){
  const $=id=>document.getElementById(id),app=$('app'),sidebar=$('dashboardSidebar');
  let current=null,dirty=false,busy=false,premium=null,drawerOpen=false,view='board';
  const optionalIds=new Set(['portfolio','team-hub','rollout','starters','policies','security','hooks','context-inspector','phase-studio']);
  const everyday=new Set(['board','companion','live','knowledge','configuration','guided','intent-studio','error-reporting']);
  const status=message=>{$('dashboardPreferenceStatus').textContent=message;};
  function background(inert){for(const child of app.children)if(child!==sidebar&&child!==$('sidebarBackdrop'))child.inert=inert;}
  function closeDrawer(){const wasOpen=drawerOpen;drawerOpen=false;app.classList.remove('sidebar-drawer-open');$('sidebarBackdrop').hidden=true;background(false);sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');$('sidebarOpen').setAttribute('aria-expanded','false');if(wasOpen)$('sidebarOpen').focus();}
  function openDrawer(){drawerOpen=true;app.classList.add('sidebar-drawer-open');$('sidebarBackdrop').hidden=false;background(true);sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');$('sidebarOpen').setAttribute('aria-expanded','true');$('sidebarClose').focus();}
  function renderGroups(){
    if(!current)return;
    $('dashboardPreferenceGroups').innerHTML=[...new Set(current.views.map(v=>v.group))].map(group=>`<section class="configuration-group"><header><h3>${escapeHtml(group)}</h3><p>Off unless you choose to show them.</p></header>${current.views.filter(v=>v.group===group).map(v=>`<label class="configuration-setting"><span><strong>${escapeHtml(v.title)}</strong><span>${escapeHtml(v.description)}</span></span><input type="checkbox" name="${escapeHtml(v.id)}" aria-label="Show ${escapeHtml(v.title)}" ${current.preferences.optional_views[v.id]?'checked':''}></label>`).join('')}</section>`).join('');
  }
  function renderNavigation(){
    const enabled=current?.views.filter(v=>current.preferences.optional_views[v.id])??[];
    $('optionalViewHeading').hidden=!enabled.length;
    $('optionalViewLinks').innerHTML=enabled.map(v=>`<button type="button" data-view="${escapeHtml(v.id)}" data-optional-view title="${escapeHtml(v.title)}"><span class="sidebar-icon" aria-hidden="true">${optionalIcon(v.id)}</span><span class="sidebar-label">${escapeHtml(v.title)}</span>${v.id==='hooks'?'<span id="hooksCount" class="nav-count">0</span>':''}</button>`).join('');
    app.classList.toggle('sidebar-collapsed',current?.preferences.sidebar_collapsed===true);
    const collapsed=current?.preferences.sidebar_collapsed===true;
    $('sidebarCollapse').setAttribute('aria-expanded',String(!collapsed));$('sidebarCollapse').setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');$('sidebarCollapse').title=collapsed?'Expand sidebar':'Collapse sidebar';
    $('sidebarCollapse').querySelector('.sidebar-icon').textContent=collapsed?'»':'«';
    markSelection();
    if(optionalIds.has(view)&&!current?.preferences.optional_views[view])onSelect('board');
  }
  function markSelection(){
    for(const button of sidebar.querySelectorAll('[data-view]')){
      const active=button.dataset.view===view;
      button.classList.toggle('active',active);
      if(active)button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
  }
  function renderPremium(){
    const active=premium?.active===true;
    $('premiumLearn').hidden=active;$('premiumSetup').hidden=active;
    $('premiumLearn').closest('.sidebar-premium').hidden=active;
    $('configurationLicenceStatus').textContent=active?'Premium personas are active':premium?.access==='available'?'Premium access is verified; the pack isn’t ready yet':premium?.access==='unavailable'?'Premium access is unavailable':'Current premium access hasn’t been verified';
    $('configurationLicenceDetail').textContent=active?`The installed pack is verified${premium.version?' · '+premium.version:''}.`:premium?.installed?'Your installed personas are still available locally. Manage your licence to check access or retry setup.':'You can continue with core personas, or manage your licence to install the premium pack.';
    for(const element of document.querySelectorAll('[data-premium-setup]'))element.hidden=active;
  }
  function apply(next){const changed=next.digest!==current?.digest;current=next;if(changed){renderNavigation();if(!dirty)renderGroups();} $('saveDashboardPreferences').disabled=false;}
  async function refresh(){
    if(busy)return;
    try{const next=await api('/api/dashboard/preferences');
      if(dirty&&current&&next.digest!==current.digest){status('Project settings changed elsewhere. Your draft is kept; cancel to reload before saving.');}
      else apply(next);
      return true;
    }catch{status('Dashboard preferences couldn’t be loaded. Check the project configuration, then refresh.');$('saveDashboardPreferences').disabled=true;return false;}
    finally{$('configurationNav').disabled=false;}
  }
  async function persist(preferences,message){
    if(!current||busy)return false;
    busy=true;$('saveDashboardPreferences').disabled=true;$('sidebarCollapse').disabled=true;
    try{const result=await api('/api/dashboard/preferences',{method:'POST',body:JSON.stringify({confirmed:true,expectedDigest:current.digest,preferences})});current=result;renderNavigation();status(message);return true;}
    catch(error){status(error.message||'Dashboard preferences couldn’t be saved. Reload the settings and try again.');return false;}
    finally{busy=false;$('saveDashboardPreferences').disabled=false;$('sidebarCollapse').disabled=false;}
  }
  $('dashboardPreferencesForm').addEventListener('change',()=>{dirty=true;status('Unsaved changes.');});
  $('dashboardPreferencesForm').addEventListener('submit',async event=>{event.preventDefault();if(!current)return;const data=new FormData(event.currentTarget);const preferences={sidebar_collapsed:current.preferences.sidebar_collapsed,optional_views:Object.fromEntries(current.views.map(v=>[v.id,data.has(v.id)]))};if(await persist(preferences,'Dashboard preferences saved.')){dirty=false;renderGroups();}});
  $('cancelDashboardPreferences').addEventListener('click',async()=>{if(busy)return;dirty=false;if(await refresh()){renderGroups();status('Unsaved changes discarded.');}});
  $('sidebarCollapse').addEventListener('click',async()=>{if(!current)return;await persist({...current.preferences,sidebar_collapsed:!current.preferences.sidebar_collapsed},dirty?'Sidebar preference saved. Your view changes are still unsaved.':'Sidebar preference saved.');});
  $('sidebarOpen').addEventListener('click',openDrawer);$('sidebarClose').addEventListener('click',closeDrawer);$('sidebarBackdrop').addEventListener('click',closeDrawer);$('managePersonaLicence').addEventListener('click',onManageLicence);
  $('premiumSetup').addEventListener('click',closeDrawer,{capture:true});
  $('premiumLearn').addEventListener('click',closeDrawer);
  document.addEventListener('keydown',event=>{
    if(!drawerOpen)return;
    if(event.key==='Escape'){event.preventDefault();closeDrawer();}
    if(event.key==='Tab'){const controls=[...sidebar.querySelectorAll('button,a')].filter(el=>!el.disabled&&el.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  });
  window.matchMedia('(max-width:720px)').addEventListener('change',closeDrawer);
  return {
    refresh,
    updatePremium(next){premium=next;renderPremium();},
    isEnabled(target){return everyday.has(target)||optionalIds.has(target)&&current?.preferences.optional_views[target]===true;},
    select(target){view=target;markSelection();closeDrawer();},
    explainDisabled(target){
      const title=current?.views.find(v=>v.id===target)?.title??'That view';
      status(`${title} is off. Enable it here and save your changes to use it.`);
    },
  };
}
