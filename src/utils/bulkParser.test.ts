import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkCsvQuestions, parseBulkJsonQuestions } from './bulkParser';
import { formatMetadataBadge, normalizeQuestionDoc, toQuestionSchemaV2 } from './questionSchema';

test('parseBulkJsonQuestions parses valid bilingual rows and catches errors', () => {
  const json = JSON.stringify([
    {
      subject: 'quant',
      topic: 'Ratio',
      difficulty: 'easy',
      yearTag: 'CGL 2024 T1',
      questionEn: 'If A:B = 2:3, find 2A:3B.',
      questionHi: 'यदि A:B = 2:3 है, तो 2A:3B ज्ञात करें।',
      optionsEn: ['4:9', '2:3', '1:2', '3:4'],
      optionsHi: ['4:9', '2:3', '1:2', '3:4'],
      correctIndex: 0,
      explanationEn: 'Multiply 2*2 and 3*3.',
    },
    {
      subject: 'invalid_subject',
      questionEn: 'Broken row',
      optionsEn: ['1', '2', '3', '4'],
      correctIndex: 0,
    },
  ]);

  const result = parseBulkJsonQuestions(json);
  assert.equal(result.valid.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.valid[0].subject, 'quant');
  assert.equal(result.valid[0].correctIndex, 0);
});

test('parseBulkJsonQuestions supports V2 snake_case schema with metadata and short_trick', () => {
  const v2Json = JSON.stringify([
    {
      question_id: 'cgl_trig_01',
      subject: 'Mathematics',
      topic: 'Trigonometry',
      question_hi: 'यदि sin θ = 3/5 है, तो tan θ का मान क्या है?',
      question_en: 'If sin θ = 3/5, what is tan θ?',
      options_hi: ['4/3', '3/4', '5/3', '4/5'],
      options_en: ['4/3', '3/4', '5/3', '4/5'],
      correct_answer_index: 1,
      metadata: {
        exam: 'SSC CGL',
        year: '2023',
        tier: 'Tier-1',
        shift: 'Shift-2',
      },
      explanation_hi: '3-4-5 समकोण त्रिभुज से tan θ = 3/4।',
      explanation_en: 'Using 3-4-5 right triangle, tan θ = 3/4.',
      short_trick: 'Triplet 3-4-5 directly gives 3/4.',
    },
  ]);

  const result = parseBulkJsonQuestions(v2Json);
  assert.equal(result.errors.length, 0);
  assert.equal(result.valid.length, 1);
  const item = result.valid[0];
  assert.equal(item.subject, 'quant');
  assert.equal(item.topic, 'Trigonometry');
  assert.equal(item.correctIndex, 1);
  assert.equal(item.metadata?.shift, 'Shift-2');
  assert.equal(item.shortTrick, 'Triplet 3-4-5 directly gives 3/4.');

  const doc = normalizeQuestionDoc(JSON.parse(v2Json)[0], 'fallback_id');
  assert.ok(doc);
  assert.equal(doc.id, 'cgl_trig_01');
  assert.equal(formatMetadataBadge(doc), '[SSC CGL 2023 Tier-1 | Shift-2]');

  const roundTrip = toQuestionSchemaV2(doc);
  assert.equal(roundTrip.question_id, 'cgl_trig_01');
  assert.equal(roundTrip.subject, 'Mathematics');
  assert.equal(roundTrip.correct_answer_index, 1);
  assert.equal(roundTrip.short_trick, 'Triplet 3-4-5 directly gives 3/4.');
});

test('parseBulkCsvQuestions handles quoted commas and letter answer keys', () => {
  const csv = [
    'subject,topic,difficulty,questionEn,optionA,optionB,optionC,optionD,answer,explanationEn',
    'ga,History,medium,"Who founded the Maurya Empire, around 321 BCE?",Ashoka,Chandragupta Maurya,Bindusara,Bimbisara,B,"Chandragupta Maurya founded it with Kautilya."',
  ].join('\n');

  const result = parseBulkCsvQuestions(csv);
  assert.equal(result.errors.length, 0);
  assert.equal(result.valid.length, 1);
  assert.equal(result.valid[0].correctIndex, 1);
  assert.equal(result.valid[0].questionEn, 'Who founded the Maurya Empire, around 321 BCE?');
});
