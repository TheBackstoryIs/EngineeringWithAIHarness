import test from 'node:test';
import assert from 'node:assert/strict';
import { makePalette } from '../public/institute/figures.js';

const keys = Array.from({ length: 400 }, (_, i) => `agent-${i}`);

test('a figure keeps the same look for the same key', () => {
  for (const key of keys.slice(0, 40)) assert.deepEqual(makePalette(key, '#335577'), makePalette(key, '#335577'));
});

test('looks vary across figures in skin tone, hair, clothing and accessories', () => {
  const palettes = keys.map((key) => makePalette(key, '#335577'));
  const seen = (field) => new Set(palettes.map((p) => p[field]));
  assert.ok(seen('skin').size >= 8, 'skin tones');
  assert.ok(seen('hair').size >= 8, 'hair colours');
  assert.ok(seen('hairStyle').size >= 8, 'hairstyles');
  assert.deepEqual([...seen('top')].sort(), ['hoodie', 'jacket', 'shirt']);
  assert.deepEqual([...seen('bottom')].sort(), ['dress', 'shorts', 'skirt', 'trousers']);
  assert.ok(palettes.some((p) => p.glasses) && palettes.some((p) => !p.glasses));
  assert.deepEqual([...seen('facial')].sort(), ['beard', 'moustache', null].sort());
});

test('the identity colour and any explicit options are kept', () => {
  const p = makePalette('runner:1', '#3c4a55', { pants: '#26323a', trim: '#c99b4c', top: 'jacket' });
  assert.equal(p.coat, '#3c4a55'); assert.equal(p.pants, '#26323a'); assert.equal(p.top, 'jacket');
  for (const key of keys) if (makePalette(key, '#fff').bottom === 'dress') assert.equal(makePalette(key, '#fff').top, 'shirt');
});
