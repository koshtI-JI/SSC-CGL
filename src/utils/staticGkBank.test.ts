import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchStaticGKQuestionDocs,
  fetchStaticGKQuestions,
  getAllStaticGkQuestionDocs,
  isGeneralAwarenessSubjectOrTopic,
} from './staticGkBank';
import {
  fetchStaticGKQuestionDocs as examEngineFetchDocs,
  fetchStaticGKQuestions as examEngineFetchQuestions,
  isGeneralAwarenessSubjectOrTopic as examEngineIsGa,
} from './examEngine';

test('isGeneralAwarenessSubjectOrTopic identifies GA subjects and topics while protecting Quant/Reasoning/English', () => {
  assert.equal(isGeneralAwarenessSubjectOrTopic('ga', 'Algebra'), true);
  assert.equal(isGeneralAwarenessSubjectOrTopic('General Awareness', ''), true);
  assert.equal(isGeneralAwarenessSubjectOrTopic('GK', ''), true);
  assert.equal(isGeneralAwarenessSubjectOrTopic('', 'History'), true);
  assert.equal(isGeneralAwarenessSubjectOrTopic('', 'Geography'), true);
  assert.equal(isGeneralAwarenessSubjectOrTopic('', 'Polity & Constitution'), true);

  assert.equal(isGeneralAwarenessSubjectOrTopic('quant', 'History'), false);
  assert.equal(isGeneralAwarenessSubjectOrTopic('reasoning', 'Blood Relations'), false);
  assert.equal(isGeneralAwarenessSubjectOrTopic('english', 'Static GK'), false);
  assert.equal(isGeneralAwarenessSubjectOrTopic('', 'Blood Relations'), false);
  assert.equal(isGeneralAwarenessSubjectOrTopic('', 'Profit & Loss'), false);
});

test('fetchStaticGKQuestions("Geography", 4) returns verified Geography PYQs including Kosi River', () => {
  const qs = fetchStaticGKQuestions('Geography', 4, { shuffle: false });
  assert.equal(qs.length, 4);

  for (const q of qs) {
    assert.equal(q.subject, 'ga');
    assert.equal(q.topic, 'Geography');
    assert.equal(q.optionsEn.length, 4);
    assert.equal(q.optionsHi?.length, 4);
    assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
    assert.ok(q.questionEn.length > 10);
    assert.ok(q.explanationEn && q.explanationEn.length > 10);
  }

  const kosi = qs.find((q) => q.questionEn.toLowerCase().includes('sorrow of bihar'));
  assert.ok(kosi, 'Expected verified Kosi River PYQ in Geography pool');
  assert.equal(kosi.optionsEn[kosi.correctIndex], 'Kosi River');
});

test('fetchStaticGKQuestions("Static GK", 4) includes Pandit Birju Maharaj without duplicates', () => {
  const qs = fetchStaticGKQuestions('Static GK', 4, { shuffle: false });
  assert.equal(qs.length, 4);

  const uniquePrompts = new Set(qs.map((q) => q.questionEn));
  assert.equal(uniquePrompts.size, 4);

  const birju = qs.find((q) => q.questionEn.includes('Birju Maharaj'));
  assert.ok(birju, 'Expected verified Pandit Birju Maharaj PYQ in Static GK pool');
  assert.ok(birju.optionsEn[birju.correctIndex].includes('Kathak'));
});

test('fetchStaticGKQuestions supplements gracefully when requested count exceeds single chapter pool', () => {
  const qs = fetchStaticGKQuestions('History', 10);
  assert.equal(qs.length, 10);

  const uniquePrompts = new Set(qs.map((q) => q.questionEn));
  assert.equal(uniquePrompts.size, 10);
  for (const q of qs) {
    assert.equal(q.subject, 'ga');
    assert.equal(q.optionsEn.length, 4);
  }
});

test('fetchStaticGKQuestionDocs returns TcsIonTestEngine-compatible QuestionDoc[] with deterministic static_gk IDs', () => {
  const allDocs = getAllStaticGkQuestionDocs();
  assert.ok(allDocs.length >= 26);

  const docs = fetchStaticGKQuestionDocs('Polity & Constitution', 3);
  assert.equal(docs.length, 3);
  for (const doc of docs) {
    assert.ok(doc.id.startsWith('static_gk_'));
    assert.equal(doc.subject, 'ga');
    assert.equal(doc.createdBy, 'verified_static_gk_bank');
    assert.equal(doc.optionsEn.length, 4);
    assert.equal(doc.optionsHi?.length, 4);
    assert.equal(typeof doc.createdAt, 'number');
    assert.equal(typeof doc.updatedAt, 'number');
  }
});

test('examEngine re-exports hybrid static GK helpers cleanly', () => {
  assert.equal(examEngineIsGa('ga', 'History'), true);
  assert.equal(examEngineFetchQuestions('History', 3).length, 3);
  assert.equal(examEngineFetchDocs('Geography', 2).length, 2);
});
