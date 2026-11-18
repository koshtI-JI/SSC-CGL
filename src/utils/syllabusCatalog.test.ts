import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findSyllabusChapterByValue,
  flattenGroupedSyllabusChapters,
  getGroupedSyllabusChapters,
} from './syllabusCatalog';

test('getGroupedSyllabusChapters returns all 4 official SSC CGL Tier-I subject groups', () => {
  const groups = getGroupedSyllabusChapters();
  assert.deepEqual(
    groups.map((g) => g.subject),
    ['quant', 'reasoning', 'english', 'ga']
  );

  const quant = groups.find((g) => g.subject === 'quant');
  const english = groups.find((g) => g.subject === 'english');
  assert.ok(quant && quant.chapters.some((c) => c.title === 'Algebra'));
  assert.ok(quant && quant.chapters.some((c) => c.title === 'Geometry'));
  assert.ok(quant && quant.chapters.some((c) => c.title === 'Profit & Loss'));
  assert.ok(english && english.chapters.some((c) => c.title === 'Cloze Test & RC'));
  assert.ok(english && english.chapters.some((c) => c.title === 'Active & Passive Voice'));
});

test('getGroupedSyllabusChapters filters accurately by chapter title, alias, or subject', () => {
  const geom = getGroupedSyllabusChapters('geometry');
  assert.equal(geom.length, 1);
  assert.equal(geom[0].subject, 'quant');
  assert.equal(geom[0].chapters[0].title, 'Geometry');

  const aliasMatch = getGroupedSyllabusChapters('bodmas');
  assert.equal(aliasMatch.length, 1);
  assert.equal(aliasMatch[0].subject, 'reasoning');
  assert.equal(aliasMatch[0].chapters[0].slug, 'reasoning_math_ops');

  const subjectMatch = getGroupedSyllabusChapters('English');
  assert.equal(subjectMatch.length, 1);
  assert.equal(subjectMatch[0].subject, 'english');
  assert.ok(subjectMatch[0].chapters.length >= 10);

  const flat = flattenGroupedSyllabusChapters(geom);
  assert.equal(flat.length, 1);
});

test('findSyllabusChapterByValue resolves exact title, slug, and alias cleanly', () => {
  assert.equal(findSyllabusChapterByValue('Profit & Loss')?.slug, 'quant_profit_loss');
  assert.equal(findSyllabusChapterByValue('english_voice')?.title, 'Active & Passive Voice');
  assert.equal(findSyllabusChapterByValue('reported speech')?.slug, 'english_narration');
  assert.equal(findSyllabusChapterByValue('nonexistent topic xyz'), null);
});
