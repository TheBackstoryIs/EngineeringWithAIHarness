import { inflateRawSync } from 'node:zlib';
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MAX_FILES = 1000, MAX_FILE = 1024 * 1024, MAX_TOTAL = 16 * 1024 * 1024;
export const MAX_PERSONA_ZIP_BYTES = 20 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function range(bytes, start, size) {
  if (!Number.isSafeInteger(start) || start < 0 || size < 0 || start + size > bytes.length) throw new Error('Malformed persona ZIP bounds');
  return bytes.subarray(start, start + size);
}
function safeName(raw) {
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch { throw new Error('Persona ZIP path is not UTF-8'); }
  if (!name || name.length > 512 || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/')) throw new Error('Unsafe persona ZIP path');
  const directory = name.endsWith('/'), parts = (directory ? name.slice(0, -1) : name).split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.') || /[. ]$/.test(p)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe persona ZIP path');
  if (!directory && !/\.(md|markdown|txt|yaml|yml|json|csv)$/i.test(name)
    && !/^(license|notice|readme)$/i.test(parts.at(-1))) throw new Error('Persona ZIP file type is not allowed');
  return { name, directory };
}

// Deliberately supports the small release format, not arbitrary ZIP/ZIP64 files.
export function extractPersonaZip(input, destination) {
  const bytes = Buffer.from(input);
  if (bytes.length < 22 || bytes.length > MAX_PERSONA_ZIP_BYTES) throw new Error('Persona ZIP exceeds archive bounds');
  if (!existsSync(destination) || !lstatSync(destination).isDirectory() || lstatSync(destination).isSymbolicLink() || readdirSync(destination).length) throw new Error('Persona ZIP requires an empty private staging directory');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Malformed persona ZIP directory');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || count !== bytes.readUInt16LE(end + 8)
    || count === 0 || count > MAX_FILES || count === 65535 || start + size !== end) throw new Error('Unsupported persona ZIP directory');
  const entries = [], names = new Map(); let position = start, total = 0, lastEnd = 0;
  for (let i = 0; i < count; i++) {
    const c = range(bytes, position, 46);
    if (c.readUInt32LE(0) !== 0x02014b50) throw new Error('Malformed persona ZIP entry');
    const flags = c.readUInt16LE(8), method = c.readUInt16LE(10), compressed = c.readUInt32LE(20), uncompressed = c.readUInt32LE(24);
    const n = c.readUInt16LE(28), extra = c.readUInt16LE(30), comment = c.readUInt16LE(32), offset = c.readUInt32LE(42);
    const raw = range(bytes, position + 46, n), path = safeName(raw), mode = c.readUInt32LE(38) >>> 16, type = mode & 0xf000;
    range(bytes, position, 46 + n + extra + comment);
    if ((flags & ~0x80e) || method !== 8 && (flags & 6) || ![0, 8].includes(method) || c.readUInt16LE(34)
      || uncompressed > MAX_FILE || compressed > MAX_PERSONA_ZIP_BYTES || (type && type !== (path.directory ? 0x4000 : 0x8000))
      || (mode & 0o111) && !path.directory) throw new Error('Unsupported or unsafe persona ZIP entry');
    total += uncompressed; if (total > MAX_TOTAL) throw new Error('Persona ZIP exceeds total content size');
    const normalized = path.name.replace(/\/$/, '').toLowerCase();
    if (names.has(normalized)) throw new Error('Duplicate persona ZIP path');
    names.set(normalized, path.directory);
    const h = range(bytes, offset, 30);
    if (offset < lastEnd || h.readUInt32LE(0) !== 0x04034b50 || h.readUInt16LE(6) !== flags || h.readUInt16LE(8) !== method
      || h.readUInt16LE(26) !== n || !range(bytes, offset + 30, n).equals(raw)) throw new Error('Malformed persona ZIP local entry');
    const dataStart = offset + 30 + n + h.readUInt16LE(28), dataEnd = dataStart + compressed;
    if (dataEnd > start || dataStart < offset + 30) throw new Error('Malformed persona ZIP data bounds');
    const data = range(bytes, dataStart, compressed);
    let body;
    try { body = method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: MAX_FILE }); }
    catch { throw new Error('Persona ZIP inflation failed or exceeded bounds'); }
    if (body.length !== uncompressed || crc32(body) !== c.readUInt32LE(16)) throw new Error('Persona ZIP CRC or size mismatch');
    if (path.directory && body.length) throw new Error('Persona ZIP directory contains data');
    if (!(flags & 8) && (h.readUInt32LE(14) !== c.readUInt32LE(16) || h.readUInt32LE(18) !== compressed || h.readUInt32LE(22) !== uncompressed)) throw new Error('Malformed persona ZIP header');
    lastEnd = dataEnd;
    entries.push({ ...path, body }); position += 46 + n + extra + comment;
  }
  if (position !== end) throw new Error('Malformed persona ZIP directory length');
  for (const e of entries) {
    const parts = e.name.replace(/\/$/, '').toLowerCase().split('/');
    for (let i = 1; i < parts.length; i++) if (names.get(parts.slice(0, i).join('/')) === false) throw new Error('Conflicting persona ZIP paths');
  }
  // Validate every entry before writing any content.
  for (const e of entries) {
    const path = resolve(destination, e.name);
    if (e.directory) mkdirSync(path, { recursive: true, mode: 0o700 });
    else { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, e.body, { flag: 'wx', mode: 0o600 }); }
  }
  return { fileCount: entries.filter(e => !e.directory).length, totalBytes: total };
}
