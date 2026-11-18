import assert from 'node:assert/strict';
import test from 'node:test';
import type { CorrectedQuestionOverrideDoc, MockTestDoc, QuestionDoc, RevisionItemDoc } from '../types/exam';
import {
  applyCorrectedQuestionOverrides,
  filterRealCohortRecords,
  isRealCohortStudentUid,
  isValidAvatarDataUrl,
  OFFLINE_AUTO_LOGOUT_MS,
  pickPopupRewardQuestions,
  POPUP_QUIZ_ACTIVE_INTERVAL_MS,
  scorePopupRewardQuiz,
  searchGlobalStudyItems,
  shouldTriggerOfflineAutoLogout,
  shouldTriggerPopupQuiz,
} from './sessionAndOverrides';

const makeQuestion = (id: string, overrides?: Partial<QuestionDoc>): QuestionDoc => ({
  id,
  subject: 'quant',
  topic: 'Percentage',
  difficulty: 'medium',
  source: 'Starter',
  questionEn: `Sample question ${id}`,
  optionsEn: ['10', '20', '30', '40'],
  correctIndex: 1,
  explanationEn: 'Initial explanation',
  createdBy: 'admin',
  ...overrides,
});

test('shouldTriggerOfflineAutoLogout strictly requires continuous >=60s offline and never triggers online', () => {
  const start = 1_000_000;
  assert.equal(OFFLINE_AUTO_LOGOUT_MS, 60_000);
  // Online: never logs out even if old timestamp exists
  assert.equal(
    shouldTriggerOfflineAutoLogout({ isOnline: true, offlineSinceMs: start, nowMs: start + 120_000 }),
    false
  );
  // Offline < 60s
  assert.equal(
    shouldTriggerOfflineAutoLogout({ isOnline: false, offlineSinceMs: start, nowMs: start + 59_999 }),
    false
  );
  // Offline === 60s
  assert.equal(
    shouldTriggerOfflineAutoLogout({ isOnline: false, offlineSinceMs: start, nowMs: start + 60_000 }),
    true
  );
});

test('isRealCohortStudentUid & filterRealCohortRecords allow real students while blocking system placeholder IDs', () => {
  const allowed = new Set(['vip_1', 'vip_2', 'damini_01', 'demo_123']);
  assert.equal(isRealCohortStudentUid('admin_preview', allowed), false);
  assert.equal(isRealCohortStudentUid('dummy_student', allowed), false);
  assert.equal(isRealCohortStudentUid('test_dummy', allowed), false);
  assert.equal(isRealCohortStudentUid('rogue_user', allowed), false);
  assert.equal(isRealCohortStudentUid('damini_01', allowed), true);
  assert.equal(isRealCohortStudentUid('demo_123', allowed), true);
  assert.equal(isRealCohortStudentUid('damini_888'), true);
  assert.equal(isRealCohortStudentUid('vip_1', allowed), true);

  const filtered = filterRealCohortRecords(
    [
      { uid: 'admin_preview' },
      { uid: 'dummy_student' },
      { uid: 'damini_01' },
      { uid: 'demo_123' },
      { uid: 'vip_1' },
      { uid: 'vip_2' },
    ],
    (x) => x.uid,
    allowed
  );
  assert.deepEqual(
    filtered.map((x) => x.uid),
    ['damini_01', 'demo_123', 'vip_1', 'vip_2']
  );
});

test('applyCorrectedQuestionOverrides propagates Admin overrides globally without mutating inputs', () => {
  const q1 = makeQuestion('q1');
  const q2 = makeQuestion('q2', { correctIndex: 0 });
  const overrideMap: Record<string, CorrectedQuestionOverrideDoc> = {
    q1: {
      id: 'q1',
      questionId: 'q1',
      subject: 'quant',
      topic: 'Profit & Loss',
      difficulty: 'hard',
      questionEn: 'Corrected Stem Q1',
      questionHi: 'संशोधित प्रश्न Q1',
      optionsEn: ['15', '25', '35', '45'],
      correctIndex: 2,
      explanationEn: 'Updated Admin solution',
      shortTrick: 'Direct ratio',
      updatedBy: 'admin',
      updatedAtMs: 12345,
    },
  };

  const merged = applyCorrectedQuestionOverrides([q1, q2], overrideMap);
  assert.equal(merged[0].questionEn, 'Corrected Stem Q1');
  assert.equal(merged[0].correctIndex, 2);
  assert.equal(merged[0].shortTrick, 'Direct ratio');
  assert.equal(merged[1].questionEn, 'Sample question q2');
  // Original untouched
  assert.equal(q1.questionEn, 'Sample question q1');
  assert.equal(q1.correctIndex, 1);
});

test('isValidAvatarDataUrl accepts compact image data URLs and rejects invalid or oversized ones', () => {
  assert.equal(isValidAvatarDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  assert.equal(isValidAvatarDataUrl('https://evil.example.com/a.png'), false);
  assert.equal(isValidAvatarDataUrl('data:image/svg+xml;base64,abc='), false);
  assert.equal(
    isValidAvatarDataUrl(`data:image/png;base64,${'A'.repeat(70_005)}`),
    false
  );
});

test('searchGlobalStudyItems matches published mocks, micro-syllabus chapters, and vault items', () => {
  const tests: MockTestDoc[] = [
    {
      id: 't1',
      title: 'Daily Trigonometry Sprint',
      subjectScope: 'quant',
      durationMinutes: 15,
      positiveMarks: 2,
      negativeMarks: 0.5,
      questionIds: ['q1'],
      questionCount: 15,
      published: true,
      createdBy: 'admin',
    },
  ];
  const vault: RevisionItemDoc[] = [
    {
      id: 'v1',
      uid: 'vip_1',
      questionId: 'q_trig',
      testId: 't1',
      testTitle: 'Trigonometry Drill',
      subject: 'quant',
      lastSelectedIndex: 0,
      mastered: false,
    },
  ];
  const hits = searchGlobalStudyItems({
    query: 'trigon',
    tests,
    revisionItems: vault,
    questionsMap: { q_trig: makeQuestion('q_trig', { topic: 'Trigonometry' }) },
  });
  assert.equal(hits.some((h) => h.kind === 'mock'), true);
  assert.equal(hits.some((h) => h.kind === 'syllabus'), true);
  assert.equal(hits.some((h) => h.kind === 'vault'), true);
});

test('popup reward quiz triggers strictly on interval, avoids exams, and scores XP cleanly', () => {
  assert.equal(
    shouldTriggerPopupQuiz({
      accumulatedActiveMs: POPUP_QUIZ_ACTIVE_INTERVAL_MS,
      lastTriggeredAtActiveMs: 0,
      isDisabledInExam: true,
    }),
    false
  );
  assert.equal(
    shouldTriggerPopupQuiz({
      accumulatedActiveMs: POPUP_QUIZ_ACTIVE_INTERVAL_MS - 10,
      lastTriggeredAtActiveMs: 0,
    }),
    false
  );
  assert.equal(
    shouldTriggerPopupQuiz({
      accumulatedActiveMs: POPUP_QUIZ_ACTIVE_INTERVAL_MS,
      lastTriggeredAtActiveMs: 0,
    }),
    true
  );

  const pool = [makeQuestion('qa'), makeQuestion('qb'), makeQuestion('qc')];
  const picked = pickPopupRewardQuestions(pool, 'vip_1_session', 2);
  assert.equal(picked.length, 2);

  const perfect = scorePopupRewardQuiz(picked, {
    [picked[0].id]: picked[0].correctIndex,
    [picked[1].id]: picked[1].correctIndex,
  });
  assert.equal(perfect.xpAwarded, 25);

  const partial = scorePopupRewardQuiz(picked, {
    [picked[0].id]: picked[0].correctIndex,
    [picked[1].id]: (picked[1].correctIndex + 1) % 4,
  });
  assert.equal(partial.xpAwarded, 10);
});
