import { hostname, homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { readPersonaLicence, personaLicencePath, personaInstallationSecret, writePrivatePersonaJson } from './persona-licence-config.mjs';
import { MAX_PERSONA_ZIP_BYTES } from './persona-zip.mjs';

export const DEFAULT_PERSONA_SERVER = 'https://www.conversationalcoding.dev';
const api = '/wp-json/conversational-coding/v1/persona-pack';
const semanticVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const safeId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const messages = {
  invalid_licence_key: 'That licence key could not be verified. Check the key in My Account and try again.',
  invalid_licence: 'That licence key could not be verified. Check the key in My Account and try again.',
  installation_limit_reached: 'This licence is already active on three machines. Deactivate a machine in My Account, then try again.',
  subscription_expired: 'This subscription has expired. Installed individual personas remain usable, but updates have ended.',
  subscription_inactive: 'This subscription is not currently available. Check My Account.',
  invalid_activation: 'This machine activation could not be verified. Configure the licence again.',
};
export function personaServer(value = DEFAULT_PERSONA_SERVER) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Persona server must be a safe HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Persona server must be a safe HTTPS origin');
  // Explicit alternative origins are for independently approved self-hosted deployments.
  return url.origin;
}
export function parsePersonaRelease(release) {
  if (!release || release.schema !== 'ewai.persona-pack/v1' || release.id !== 'ewai.personas.professional'
    || !semanticVersion.test(release.version) || !/^[a-f0-9]{64}$/.test(release.artefact?.sha256)
    || !Number.isSafeInteger(release.artefact.size) || release.artefact.size < 22 || release.artefact.size > MAX_PERSONA_ZIP_BYTES) throw new Error('The persona release contract could not be verified');
  return { version: release.version, sha256: release.artefact.sha256, size: release.artefact.size };
}
export function parsePersonaSubscription(data) {
  if (!data || !safeId(data.id) || !['individual', 'team'].includes(data.plan_type)
    || !['active', 'grace', 'cancelled', 'expired', 'pending', 'revoked', 'refunded'].includes(data.status)
    || typeof data.ends_at !== 'string' || !Number.isFinite(Date.parse(data.ends_at))) throw new Error('The persona subscription contract could not be verified');
  return { id: data.id, planType: data.plan_type, status: data.status, endsAt: new Date(data.ends_at).toISOString() };
}

async function request(url, options, limit, context) {
  const signal = AbortSignal.timeout(context.timeout ?? 8000);
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(new Error('timeout'));
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  // Keep a deadline alive even for a test/custom transport with no socket.
  const deadline = setTimeout(rejectAbort, context.timeout ?? 8000);
  try {
    const response = await Promise.race([(context.fetchImpl ?? fetch)(url, { ...options, redirect: 'error', signal }), aborted]);
    if (response.redirected) throw new Error('redirect');
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error('size');
    const reader = response.body?.getReader(); if (!reader) throw new Error('empty');
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        size += part.value.byteLength; if (size > limit) throw new Error('size');
        chunks.push(Buffer.from(part.value));
      }
    } finally { void reader.cancel().catch(() => {}); }
    return { response, bytes: Buffer.concat(chunks, size) };
  } catch { throw new Error('Persona access could not be checked safely. Check your connection and try again; installed content has not been removed.'); }
  finally { clearTimeout(deadline); signal.removeEventListener('abort', rejectAbort); }
}
async function jsonRequest(url, options, context) {
  const { response, bytes } = await request(url, options, 64 * 1024, context);
  let body;
  try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('The persona service returned an unsupported response. Installed content has not been removed.'); }
  if (!response.ok) {
    const code = Object.hasOwn(messages, body?.code) ? body.code : 'provider-access-unknown';
    const error = new Error(messages[code] || 'Persona access could not be verified. Installed content has not been removed.');
    error.code = code; throw error;
  }
  return body;
}
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const version = options => options.clientVersion || packageVersion;
const headers = token => ({ Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) });

export async function configurePersonaLicence(options = {}) {
  const home = options.home ?? homedir(), server = personaServer(options.server);
  const prior = readPersonaLicence(home);
  const licenceKey = String(options.licenceKey ?? '').trim();
  if (!licenceKey || licenceKey.length > 512 || /[\x00-\x1f\x7f]/.test(licenceKey)) throw new Error('Enter a valid licence key using the private terminal prompt');
  const installationSecret = personaInstallationSecret(home);
  const machineName = String(options.machineName ?? hostname()).trim();
  if (!machineName || machineName.length > 120 || /[\x00-\x1f\x7f]/.test(machineName)) throw new Error('Machine name must be a short readable label');
  const data = await jsonRequest(server + api + '/activations', {
    method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ licence_key: licenceKey, installation_secret: installationSecret, machine_name: machineName, product: 'engineering-with-ai', client_version: version(options) }),
  }, options);
  if (data.schema !== 'cce.activation/v1' || !safeId(data.activation_id) || typeof data.activation_token !== 'string'
    || data.activation_token.length < 16 || data.activation_token.length > 512 || /[\x00-\x20\x7f]/.test(data.activation_token)) throw new Error('Machine activation returned an unsupported contract; existing credentials were kept');
  // Older server activations can be stored, but cannot prove plan-specific expiry.
  const subscription = data.subscription ? parsePersonaSubscription(data.subscription) : null;
  const seatId = safeId(data.seat_id) ? data.seat_id : null;
  writePrivatePersonaJson(home, personaLicencePath(home), {
    schema: 'ewai.persona-licence/v1', server, licenceKey, installationSecret,
    activationId: data.activation_id, activationToken: data.activation_token, seatId, subscription, machineName,
  });
  return { schema: 'ewai.persona-licence-setup/v1', status: 'configured', provider: 'wordpress-edd', replaced: Boolean(prior), machineLimit: 3 };
}

export async function websitePersonaStatus(credentials, options = {}) {
  const server = personaServer(credentials.server);
  const data = await jsonRequest(server + api + '/status?product=engineering-with-ai&client_version=' + encodeURIComponent(version(options)), { headers: headers(credentials.activationToken) }, options);
  if (data.schema !== 'cce.entitlement-status/v1' || !['available', 'unavailable'].includes(data.access)
    || !safeId(data.seat?.id) || data.activation?.id !== credentials.activationId) throw new Error('The persona status contract could not be verified; installed content has not been removed');
  const subscription = parsePersonaSubscription(data.subscription);
  if (credentials.seatId && credentials.seatId !== data.seat.id) throw new Error('The licensed seat changed unexpectedly; configure the licence again');
  if (data.access === 'available' && (!['active', 'grace', 'cancelled'].includes(subscription.status) || Date.parse(subscription.endsAt) <= Date.now())) throw new Error('The persona status contract is inconsistent');
  if (subscription.status === 'expired' && (data.access !== 'unavailable' || Date.parse(subscription.endsAt) > Date.now())) throw new Error('The persona expiry contract is inconsistent');
  return { access: data.access, subscription, seatId: data.seat.id, server, release: data.access === 'available' ? parsePersonaRelease(data.release) : null };
}

export async function acquireWebsitePersonaArchive(credentials, status, options = {}) {
  if (status.access !== 'available') throw new Error('Persona updates are unavailable for this subscription');
  const server = personaServer(credentials.server);
  const grant = await jsonRequest(server + api + '/download-grants', {
    method: 'POST', headers: { ...headers(credentials.activationToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: 'engineering-with-ai', client_version: version(options) }),
  }, options);
  let url; try { url = new URL(grant.download_url); } catch { throw new Error('The persona download grant is invalid'); }
  const release = parsePersonaRelease(grant.release);
  if (grant.schema !== 'cce.download-grant/v1' || url.origin !== server || url.username || url.password || url.hash
    || url.pathname !== '/' || [...url.searchParams.keys()].some(k => k !== 'cce-download')
    || !url.searchParams.get('cce-download') || url.searchParams.getAll('cce-download').length !== 1
    || !Number.isFinite(Date.parse(grant.expires_at)) || Date.parse(grant.expires_at) <= Date.now()
    || release.sha256 !== status.release.sha256 || release.version !== status.release.version || release.size !== status.release.size) throw new Error('The persona download grant could not be verified; check for updates and retry');
  const { response, bytes } = await request(url.href, { headers: { Accept: 'application/zip' } }, MAX_PERSONA_ZIP_BYTES, options);
  if (!response.ok) throw new Error('The short-lived persona download could not be completed; request a fresh download');
  return bytes;
}
