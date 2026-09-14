import { createHash, randomUUID } from 'node:crypto';

const inputFields = new Set([
  'capability', 'errorCode', 'command', 'ewaiVersion', 'nodeVersion', 'osClass',
  'installationSource', 'title', 'expected', 'actual', 'reproductionSteps',
]);
const revisionFields = new Set(['title', 'expected', 'actual', 'reproductionSteps']);
const osClasses = new Set(['darwin', 'linux', 'win32', 'other']);
const installationSources = new Set(['npm', 'git', 'local', 'unknown']);
const maxAttachmentBytes = 5 * 1024 * 1024;
const maxPackageBytes = 25 * 1024 * 1024;
const safeAttachmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const absolutePathPattern = /(?:^|\s)(?:\/(?:Users|home|private|var|etc|opt|srv|mnt|Volumes)\/|[A-Za-z]:\\)/;
const credentialPattern = /(?:Bearer\s+[A-Za-z0-9._~+\/-]{8,}|sk-[A-Za-z0-9_-]{8,}|(?:token|password|secret|api[_-]?key)\s*[:=])/i;

export const ERROR_REPORT_EXCLUDED_CLASSES = Object.freeze([
  'absolute-paths',
  'credentials',
  'environment-values',
  'persona-bodies',
  'prompts-and-responses',
  'raw-logs',
  'repository-names',
  'source-and-specs',
]);

const excludedClassByKey = Object.freeze({
  absolutePath: 'absolute-paths',
  paths: 'absolute-paths',
  credential: 'credentials',
  credentials: 'credentials',
  environment: 'environment-values',
  environmentValues: 'environment-values',
  persona: 'persona-bodies',
  personaBody: 'persona-bodies',
  prompt: 'prompts-and-responses',
  response: 'prompts-and-responses',
  rawLog: 'raw-logs',
  logs: 'raw-logs',
  repositoryName: 'repository-names',
  repositoryNames: 'repository-names',
  source: 'source-and-specs',
  specs: 'source-and-specs',
});

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function canonicalJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function strictFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new Error(`${label} contains unknown field: ${key}`);
  }
}

function boundedText(value, label, max, options = {}) {
  const text = String(value ?? '').trim();
  if ((!text && options.required !== false) || text.length > max) throw new Error(`${label} is missing or exceeds ${max} characters.`);
  if (text.includes('\0') || credentialPattern.test(text)) throw new Error(`${label} contains unsafe credential-shaped content.`);
  if (absolutePathPattern.test(text)) throw new Error(`${label} contains an absolute path.`);
  return text;
}

function normaliseDescription(input) {
  if (!Array.isArray(input.reproductionSteps) || input.reproductionSteps.length > 50) {
    throw new Error('Reproduction steps must be a bounded array of at most 50 entries.');
  }
  return {
    title: boundedText(input.title, 'Report title', 500),
    expected: boundedText(input.expected, 'Expected behaviour', 4000, { required: false }),
    actual: boundedText(input.actual, 'Actual behaviour', 4000, { required: false }),
    reproductionSteps: input.reproductionSteps.map((step) => boundedText(step, 'Reproduction step', 1000)),
  };
}

function normaliseDiagnostics(input) {
  const capability = String(input.capability ?? '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability)) throw new Error('Capability must be lower kebab-case.');
  const errorCode = String(input.errorCode ?? '').trim();
  if (!/^[A-Z][A-Z0-9-]{2,79}$/.test(errorCode)) throw new Error('Public error code is invalid.');
  const command = String(input.command ?? '').trim();
  if (!/^ewai(?: [a-z0-9][a-z0-9:-]*){0,4}$/.test(command) || command.length > 160) throw new Error('Command identity is invalid or unsafe.');
  const ewaiVersion = String(input.ewaiVersion ?? '').trim();
  const nodeVersion = String(input.nodeVersion ?? '').trim().replace(/^v/, '');
  if (!/^[0-9]+(?:\.[0-9]+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/.test(ewaiVersion)) throw new Error('EWAI version is invalid.');
  if (!/^[0-9]+(?:\.[0-9]+){0,2}$/.test(nodeVersion)) throw new Error('Node version is invalid.');
  const osClass = String(input.osClass ?? '').trim();
  if (!osClasses.has(osClass)) throw new Error('OS class is invalid.');
  const installationSource = String(input.installationSource ?? '').trim();
  if (!installationSources.has(installationSource)) throw new Error('Installation source is invalid.');
  return { capability, errorCode, command, ewaiVersion, nodeVersion, osClass, installationSource };
}

function redactionSummary(excluded = {}) {
  if (!excluded || typeof excluded !== 'object' || Array.isArray(excluded)) throw new Error('Excluded diagnostics must be an object.');
  const counts = {};
  for (const [key, value] of Object.entries(excluded)) {
    const className = excludedClassByKey[key];
    if (!className) throw new Error(`Excluded diagnostics contain unknown class: ${key}`);
    const count = Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : value === undefined || value === null || value === '' ? 0 : 1;
    counts[className] = (counts[className] ?? 0) + count;
  }
  const classes = Object.keys(counts).filter((key) => counts[key] > 0).sort();
  return {
    schema: 'ewai.error-report-redactions/v1',
    classes,
    counts: Object.fromEntries(classes.map((name) => [name, counts[name]])),
  };
}

function reportId(value) {
  const id = String(value ?? `report_${randomUUID().replaceAll('-', '')}`).trim();
  if (!/^report_[a-z0-9_]{3,80}$/.test(id)) throw new Error('Report id is invalid.');
  return id;
}

function isoTimestamp(value) {
  const text = String(value ?? new Date().toISOString());
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(text) || Number.isNaN(Date.parse(text))) throw new Error('Report timestamp is invalid.');
  return text;
}

export function createErrorReportDraft(input, options = {}) {
  strictFields(input, inputFields, 'Error report input');
  const at = isoTimestamp(options.at);
  return {
    schema: 'ewai.error-report/v1',
    id: reportId(options.id),
    status: 'draft',
    revision: 1,
    createdAt: at,
    updatedAt: at,
    diagnostics: normaliseDiagnostics(input),
    description: normaliseDescription(input),
    redactions: redactionSummary(options.excluded),
    attachments: [],
  };
}

export function errorReportIdentity(report) {
  const identity = {
    schema: report.schema,
    id: report.id,
    revision: report.revision,
    diagnostics: report.diagnostics,
    description: report.description,
    redactions: report.redactions,
    attachments: report.attachments,
  };
  return digest(Buffer.from(canonicalJson(identity)));
}

export function reviseErrorReport(report, changes, options = {}) {
  if (report.status !== 'draft') throw new Error('A finalised error report is immutable; create a new revision instead.');
  strictFields(changes, revisionFields, 'Error report revision');
  const description = normaliseDescription({ ...report.description, ...changes });
  return {
    ...report,
    revision: report.revision + 1,
    updatedAt: isoTimestamp(options.at),
    description,
    package: undefined,
  };
}

function attachmentMembers(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length > 20) throw new Error('Attachments must be a bounded array of at most 20 entries.');
  let total = 0;
  const seen = new Set();
  return attachments.map((attachment) => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) throw new Error('Attachment must be an object.');
    for (const key of Object.keys(attachment)) if (!['name', 'bytes'].includes(key)) throw new Error(`Attachment contains unknown field: ${key}`);
    const name = String(attachment.name ?? '').trim();
    if (!safeAttachmentPattern.test(name) || name === '.' || name === '..' || seen.has(name.toLowerCase())) throw new Error('Attachment name is unsafe or duplicated.');
    seen.add(name.toLowerCase());
    const bytes = Buffer.isBuffer(attachment.bytes) ? attachment.bytes : Buffer.from(attachment.bytes ?? '');
    if (bytes.length > maxAttachmentBytes) throw new Error('Attachment is too large.');
    total += bytes.length;
    if (total > maxPackageBytes) throw new Error('Attachment package is too large.');
    return { name: `attachments/${name}`, bytes };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function summaryMarkdown(report) {
  const steps = report.description.reproductionSteps.length
    ? report.description.reproductionSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')
    : 'No reproduction steps supplied.';
  return `# ${report.description.title}\n\n## Expected behaviour\n\n${report.description.expected || 'Not supplied.'}\n\n## Actual behaviour\n\n${report.description.actual || 'Not supplied.'}\n\n## Reproduction steps\n\n${steps}\n`;
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, value) => {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      return crc >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(members) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf8');
    const bytes = member.bytes;
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + bytes.length;
  }
  const centralBytes = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBytes, end]);
}

export function buildErrorReportPackage(report, options = {}) {
  if (!report || report.schema !== 'ewai.error-report/v1') throw new Error('A valid EWAI error report is required.');
  const diagnostics = Buffer.from(canonicalJson({
    schema: 'ewai.error-report-diagnostics/v1',
    reportId: report.id,
    revision: report.revision,
    diagnostics: report.diagnostics,
  }));
  const redactions = Buffer.from(canonicalJson(report.redactions));
  const summary = Buffer.from(summaryMarkdown(report));
  const members = [
    { name: 'diagnostics.json', bytes: diagnostics },
    { name: 'redaction-report.json', bytes: redactions },
    { name: 'summary.md', bytes: summary },
    ...attachmentMembers(options.attachments),
  ];
  const memberRecords = members.map((member) => ({ name: member.name, size: member.bytes.length, digest: digest(member.bytes) }));
  const packageDigest = digest(Buffer.from(canonicalJson(memberRecords)));
  const manifest = {
    schema: 'ewai.error-report-package/v1',
    reportId: report.id,
    revision: report.revision,
    packageDigest,
    members: memberRecords,
  };
  const archiveMembers = [...members, { name: 'manifest.json', bytes: Buffer.from(canonicalJson(manifest)) }];
  const bytes = storedZip(archiveMembers);
  if (bytes.length > maxPackageBytes) throw new Error('Final error-report package is too large.');
  return { schema: 'ewai.error-report-package-result/v1', bytes, manifest, packageDigest, archiveDigest: digest(bytes), size: bytes.length, memberCount: archiveMembers.length };
}

export function finaliseErrorReport(report, options = {}) {
  if (report.status === 'finalised') throw new Error('Error report is already finalised.');
  if (report.status !== 'draft') throw new Error('Only a draft error report can be finalised.');
  const packaged = buildErrorReportPackage(report, options);
  const attachmentRecords = packaged.manifest.members.filter(({ name }) => name.startsWith('attachments/')).map(({ name, size, digest: memberDigest }) => ({
    name: name.slice('attachments/'.length), size, digest: memberDigest,
  }));
  const finalised = {
    ...report,
    status: 'finalised',
    updatedAt: isoTimestamp(options.at),
    attachments: attachmentRecords,
    package: {
      packageDigest: packaged.packageDigest,
      archiveDigest: packaged.archiveDigest,
      size: packaged.size,
      memberCount: packaged.memberCount,
    },
  };
  return { report: finalised, package: packaged };
}
