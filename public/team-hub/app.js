const state = { portfolio: null, selectedId: null, resources: null, selectedResource: null };
const tokenInput = document.querySelector('#hubToken');
const message = document.querySelector('#message');
const portfolioSection = document.querySelector('#portfolio');
const projectList = document.querySelector('#projectList');
const projectDetail = document.querySelector('#projectDetail');
const summary = document.querySelector('#summary');
const resourceRegistry = document.querySelector('#resourceRegistry');
const resourceList = document.querySelector('#resourceList');
const resourceDetail = document.querySelector('#resourceDetail');

function el(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

async function teamHubApi(path, token = sessionStorage.getItem('ewai.team-hub.token')) {
  const response = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Team Hub returned HTTP ${response.status}.`);
  return body;
}

function evidenceRow(label, value) {
  const row = el('div', 'evidence-row');
  row.append(el('dt', '', label), el('dd', '', value ?? 'Not available'));
  return row;
}

function renderSummary() {
  summary.replaceChildren();
  for (const [label, value] of Object.entries({ Projects: state.portfolio.summary.total, Current: state.portfolio.summary.current, Stale: state.portfolio.summary.stale, Attention: state.portfolio.summary.attention })) {
    const card = el('div', 'summary-card');
    card.append(el('span', 'summary-value', value), el('span', 'summary-label', label));
    summary.append(card);
  }
}

function renderDetail() {
  const project = state.portfolio?.projects.find(({ id }) => id === state.selectedId);
  projectDetail.replaceChildren();
  if (!project) {
    projectDetail.append(el('p', 'empty-state', 'Choose a connected project.'));
    return;
  }
  const heading = el('header', 'detail-heading');
  const title = el('div');
  title.append(el('p', 'eyebrow', 'SELECTED PROJECT'), el('h3', '', project.name));
  heading.append(title, el('span', `freshness freshness-${project.freshness.state}`, project.freshness.state));
  const evidence = el('dl', 'evidence-grid');
  evidence.append(
    evidenceRow('Last accepted', project.evidence.acceptedAt),
    evidenceRow('Submitted', project.evidence.submittedAt),
    evidenceRow('Receipt', project.evidence.receiptId),
    evidenceRow('Snapshot digest', project.evidence.snapshotDigest),
    evidenceRow('EWAI', project.ewaiVersion),
    evidenceRow('Revision digest', project.revisionDigest),
  );
  const delivery = el('section', 'detail-section');
  delivery.append(el('h4', '', 'Latest delivery'));
  if (project.delivery) {
    delivery.append(el('p', '', `${project.delivery.title} · ${project.delivery.currentPhase} · ${project.delivery.status}`));
  } else delivery.append(el('p', 'muted', 'No delivery summary was submitted.'));
  const attention = el('section', 'detail-section');
  attention.append(el('h4', '', 'Attention'));
  if (!project.attention.length) attention.append(el('p', 'muted', 'No bounded attention items were submitted or derived.'));
  else {
    const list = el('ul', 'attention-list');
    for (const item of project.attention) list.append(el('li', `attention-${item.severity}`, item.summary));
    attention.append(list);
  }
  projectDetail.append(heading, evidence, delivery, attention);
  projectDetail.focus();
}

function renderProjects() {
  projectList.replaceChildren();
  for (const project of state.portfolio.projects) {
    const item = el('li');
    const button = el('button', 'project-button');
    button.type = 'button';
    button.dataset.projectId = project.id;
    button.setAttribute('aria-current', project.id === state.selectedId ? 'true' : 'false');
    button.append(el('span', 'project-name', project.name), el('span', 'project-meta', `${project.freshness.state} · ${project.attention.length} attention`));
    item.append(button);
    projectList.append(item);
  }
}

function resourceKey(resource) { return `${resource.id}@${resource.version}`; }

function renderResourceDetail() {
  const resource = state.resources?.releases.find((item) => resourceKey(item) === state.selectedResource);
  resourceDetail.replaceChildren();
  if (!resource) {
    resourceDetail.append(el('p', 'empty-state', 'Choose an immutable release.'));
    return;
  }
  const heading = el('header', 'detail-heading');
  const title = el('div');
  title.append(el('p', 'eyebrow', resource.kind.replaceAll('-', ' ').toUpperCase()), el('h3', '', resource.name));
  heading.append(title, el('span', 'freshness freshness-current', `v${resource.version}`));
  const identity = el('dl', 'evidence-grid');
  identity.append(
    evidenceRow('Resource ID', resource.id),
    evidenceRow('Package digest', resource.digest),
    evidenceRow('Publisher', `${resource.publisher.name} (${resource.publisher.id})`),
    evidenceRow('EWAI compatibility', resource.compatibility.ewai),
    evidenceRow('Package bounds', `${resource.fileCount} files · ${resource.totalBytes} bytes`),
    evidenceRow('Published', resource.publishedAt),
    evidenceRow('Receipt', resource.receiptId),
  );
  const boundary = el('section', 'detail-section');
  boundary.append(el('h4', '', 'Authority boundary'), el('p', 'muted', 'This release is available to authenticated readers. A contributor must still download, verify, explicitly install, then select or apply it separately.'));
  const chain = el('section', 'detail-section');
  chain.append(el('h4', '', 'Retained versions'));
  const versions = el('ul', 'attention-list');
  for (const release of state.resources.releases.filter(({ id }) => id === resource.id)) {
    versions.append(el('li', '', `v${release.version} · ${release.digest}`));
  }
  chain.append(versions);
  resourceDetail.append(heading, identity, chain, boundary);
  resourceDetail.focus();
}

function renderResources() {
  resourceList.replaceChildren();
  for (const resource of state.resources?.releases ?? []) {
    const item = el('li');
    const button = el('button', 'project-button');
    button.type = 'button';
    button.dataset.resourceKey = resourceKey(resource);
    button.setAttribute('aria-current', resourceKey(resource) === state.selectedResource ? 'true' : 'false');
    button.append(el('span', 'project-name', resource.name), el('span', 'project-meta', `${resource.kind.replaceAll('-', ' ')} · v${resource.version}`));
    item.append(button); resourceList.append(item);
  }
  if (!(state.resources?.releases?.length)) resourceList.append(el('li', 'empty-state', 'No governed releases have been published.'));
  renderResourceDetail();
}

async function loadResources(token) {
  state.resources = await teamHubApi('/api/v1/resources', token);
  state.selectedResource = state.resources.releases[0] ? resourceKey(state.resources.releases[0]) : null;
  resourceRegistry.hidden = false;
  renderResources();
}

async function loadPortfolio(token) {
  message.textContent = 'Loading portfolio…';
  try {
    state.portfolio = await teamHubApi('/api/v1/portfolio', token);
    state.selectedId = state.portfolio.projects[0]?.id ?? null;
    portfolioSection.hidden = false;
    renderSummary(); renderProjects(); renderDetail();
    message.textContent = `Portfolio refreshed at ${state.portfolio.generatedAt}.`;
  } catch (error) {
    portfolioSection.hidden = true;
    message.textContent = error.message;
    throw error;
  }
}

async function loadHubSurfaces(token) {
  const results = await Promise.allSettled([loadPortfolio(token), loadResources(token)]);
  if (results.some(({ status }) => status === 'fulfilled')) {
    sessionStorage.setItem('ewai.team-hub.token', token);
    message.textContent = 'Authenticated views refreshed.';
    return;
  }
  sessionStorage.removeItem('ewai.team-hub.token');
  throw results[0].reason;
}

document.querySelector('#accessForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const token = tokenInput.value;
  loadHubSurfaces(token).catch((error) => { message.textContent = error.message; });
  tokenInput.value = '';
});
document.querySelector('#refreshPortfolio').addEventListener('click', () => loadPortfolio(sessionStorage.getItem('ewai.team-hub.token')).catch((error) => { message.textContent = error.message; }));
document.querySelector('#refreshResources').addEventListener('click', () => loadResources(sessionStorage.getItem('ewai.team-hub.token')).catch((error) => { message.textContent = error.message; }));
projectList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-project-id]');
  if (!button) return;
  state.selectedId = button.dataset.projectId;
  renderProjects(); renderDetail();
});
resourceList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-resource-key]');
  if (!button) return;
  state.selectedResource = button.dataset.resourceKey;
  renderResources();
});

teamHubApi('/health', '').then((health) => {
  document.querySelector('#serviceState').textContent = `${health.status} · ${health.bind} · built-in TLS ${health.tls ? 'on' : 'off'}`;
}).catch(() => { document.querySelector('#serviceState').textContent = 'Service health unavailable'; });

const sessionToken = sessionStorage.getItem('ewai.team-hub.token');
if (sessionToken) loadHubSurfaces(sessionToken).catch(() => {});
