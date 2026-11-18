import type { CohortTaskDoc, SubjectKey } from '../types/exam';
import { ENGLISH_STARTER_QUESTIONS } from './sscEnglishBank';
import { GA_STARTER_QUESTIONS } from './sscGaBank';
import { QUANT_STARTER_QUESTIONS, type StarterQuestionSeed } from './sscQuantBank';
import { REASONING_STARTER_QUESTIONS } from './sscReasoningBank';

export type { StarterQuestionSeed };

export interface StarterTestSeed {
  seedId: string;
  title: string;
  subjectScope: 'full' | SubjectKey;
  durationMinutes: number;
  positiveMarks: number;
  negativeMarks: number;
  questionSeedIds: string[];
}

export interface StarterTaskSeed extends Omit<CohortTaskDoc, 'id' | 'createdAt' | 'updatedAt'> {
  seedId: string;
}

export const STARTER_QUESTIONS: StarterQuestionSeed[] = [
  ...QUANT_STARTER_QUESTIONS,
  ...REASONING_STARTER_QUESTIONS,
  ...ENGLISH_STARTER_QUESTIONS,
  ...GA_STARTER_QUESTIONS,
];

const quantIds = QUANT_STARTER_QUESTIONS.map((q) => q.seedId);
const reasIds = REASONING_STARTER_QUESTIONS.map((q) => q.seedId);
const engIds = ENGLISH_STARTER_QUESTIONS.map((q) => q.seedId);
const gaIds = GA_STARTER_QUESTIONS.map((q) => q.seedId);

export const STARTER_TESTS: StarterTestSeed[] = [
  // --- FULL-LENGTH & TIER-I / TIER-II COMBINED MOCKS ---
  {
    seedId: 'ssc_test_full_100_02',
    title: 'SSC CGL Tier-I Complete 100-Q Mega Mock #02 (25×4 Pattern)',
    subjectScope: 'full',
    durationMinutes: 60,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: [
      ...quantIds.slice(0, 25),
      ...reasIds.slice(0, 25),
      ...engIds.slice(0, 25),
      ...gaIds.slice(0, 25),
    ],
  },
  {
    seedId: 'ssc_test_full_01',
    title: 'SSC CGL Tier-I Bilingual Full Mock #01',
    subjectScope: 'full',
    durationMinutes: 30,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: [
      ...quantIds.slice(0, 7),
      ...reasIds.slice(0, 7),
      ...engIds.slice(0, 7),
      ...gaIds.slice(0, 7),
    ],
  },
  {
    seedId: 'ssc_test_full_pyq_03',
    title: 'SSC CGL Tier-I High-Yield PYQ Full Mock #03',
    subjectScope: 'full',
    durationMinutes: 30,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: [
      ...quantIds.slice(20, 30),
      ...reasIds.slice(20, 30),
      ...engIds.slice(20, 30),
      ...gaIds.slice(20, 30),
    ],
  },
  {
    seedId: 'ssc_test_full_speed_04',
    title: 'SSC CGL Tier-I Rapid Fire Full Mock #04',
    subjectScope: 'full',
    durationMinutes: 25,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: [
      ...quantIds.slice(10, 20),
      ...reasIds.slice(10, 20),
      ...engIds.slice(10, 20),
      ...gaIds.slice(10, 20),
    ],
  },
  {
    seedId: 'ssc_test_tier2_sec1',
    title: 'SSC CGL Tier-II Paper-I Section-I (Maths + Reasoning, +3/-1)',
    subjectScope: 'full',
    durationMinutes: 45,
    positiveMarks: 3,
    negativeMarks: 1,
    questionSeedIds: [...quantIds.slice(10, 30), ...reasIds.slice(10, 30)],
  },
  {
    seedId: 'ssc_test_tier2_sec2',
    title: 'SSC CGL Tier-II Paper-I Section-II (English + GA, +3/-1)',
    subjectScope: 'full',
    durationMinutes: 45,
    positiveMarks: 3,
    negativeMarks: 1,
    questionSeedIds: [...engIds.slice(10, 30), ...gaIds.slice(10, 30)],
  },
  {
    seedId: 'ssc_test_reas_eng_01',
    title: 'Reasoning + English Accuracy Sprint #01',
    subjectScope: 'full',
    durationMinutes: 15,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: [...reasIds.slice(0, 7), ...engIds.slice(0, 7)],
  },
  {
    seedId: 'ssc_test_quant_ga_01',
    title: 'Quant + General Awareness Power Combo #01',
    subjectScope: 'full',
    durationMinutes: 18,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: [...quantIds.slice(0, 10), ...gaIds.slice(0, 10)],
  },

  // --- QUANTITATIVE APTITUDE SECTIONALS ---
  {
    seedId: 'ssc_test_quant_01',
    title: 'Quantitative Aptitude Speed Drill #01',
    subjectScope: 'quant',
    durationMinutes: 10,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: quantIds.slice(0, 7),
  },
  {
    seedId: 'ssc_test_quant_02',
    title: 'Quantitative Aptitude — Arithmetic Mastery #02',
    subjectScope: 'quant',
    durationMinutes: 18,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: [
      ...quantIds.slice(0, 4),
      ...quantIds.slice(6, 10),
      ...quantIds.slice(18, 25),
    ],
  },
  {
    seedId: 'ssc_test_quant_03',
    title: 'Quantitative Aptitude — Advance Maths (Algebra, Trig & Geo) #03',
    subjectScope: 'quant',
    durationMinutes: 20,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: [
      quantIds[4],
      quantIds[5],
      ...quantIds.slice(10, 18),
      ...quantIds.slice(25, 30),
    ],
  },
  {
    seedId: 'ssc_test_quant_04',
    title: 'Quantitative Aptitude Full 30-Q Marathon #04',
    subjectScope: 'quant',
    durationMinutes: 30,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: quantIds,
  },

  // --- GENERAL INTELLIGENCE & REASONING SECTIONALS ---
  {
    seedId: 'ssc_test_reas_01',
    title: 'General Intelligence & Reasoning Speed Drill #01',
    subjectScope: 'reasoning',
    durationMinutes: 12,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: reasIds.slice(0, 15),
  },
  {
    seedId: 'ssc_test_reas_02',
    title: 'Reasoning — Coding, Syllogism & Puzzles Drill #02',
    subjectScope: 'reasoning',
    durationMinutes: 12,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: reasIds.slice(15, 30),
  },
  {
    seedId: 'ssc_test_reas_03',
    title: 'General Intelligence & Reasoning Full 30-Q Marathon #03',
    subjectScope: 'reasoning',
    durationMinutes: 22,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: reasIds,
  },

  // --- ENGLISH COMPREHENSION SECTIONALS ---
  {
    seedId: 'ssc_test_eng_01',
    title: 'English — Vocab, Idioms & One-Word Booster #01',
    subjectScope: 'english',
    durationMinutes: 10,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: engIds.slice(0, 15),
  },
  {
    seedId: 'ssc_test_eng_02',
    title: 'English — Grammar, Voice, Narration & PQRS #02',
    subjectScope: 'english',
    durationMinutes: 12,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: engIds.slice(15, 30),
  },
  {
    seedId: 'ssc_test_eng_03',
    title: 'English Comprehension Full 30-Q Marathon #03',
    subjectScope: 'english',
    durationMinutes: 20,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: engIds,
  },

  // --- GENERAL AWARENESS SECTIONALS ---
  {
    seedId: 'ssc_test_ga_01',
    title: 'General Awareness & GS Booster #01',
    subjectScope: 'ga',
    durationMinutes: 8,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: gaIds.slice(0, 7),
  },
  {
    seedId: 'ssc_test_ga_02',
    title: 'General Awareness — Polity, History & Geography #02',
    subjectScope: 'ga',
    durationMinutes: 10,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: gaIds.slice(7, 22),
  },
  {
    seedId: 'ssc_test_ga_03',
    title: 'General Awareness — Science, Economy & Static GK #03',
    subjectScope: 'ga',
    durationMinutes: 10,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: [gaIds[3], gaIds[4], gaIds[5], gaIds[6], ...gaIds.slice(19, 30)],
  },
  {
    seedId: 'ssc_test_ga_04',
    title: 'General Awareness Full 30-Q Marathon #04',
    subjectScope: 'ga',
    durationMinutes: 18,
    positiveMarks: 2,
    negativeMarks: 0.5,
    questionSeedIds: gaIds,
  },
];

export const STARTER_TASKS: StarterTaskSeed[] = [
  {
    seedId: 'ssc_task_ga_daily',
    title: 'GS Daily Accuracy Sprint',
    description: 'Attempt at least 1 General Awareness quiz or full mock today to unlock +40 Bonus XP.',
    targetTests: 1,
    targetSubject: 'ga',
    bonusXp: 40,
    dueDate: '2026-11-30',
    active: true,
  },
  {
    seedId: 'ssc_task_quant_drill',
    title: 'Quant Speed Mastery',
    description: 'Complete 2 tests covering Quantitative Aptitude to unlock +60 Bonus XP.',
    targetTests: 2,
    targetSubject: 'quant',
    bonusXp: 60,
    dueDate: '2026-11-30',
    active: true,
  },
  {
    seedId: 'ssc_task_eng_accuracy',
    title: 'English Comprehension Streak',
    description: 'Complete 2 English Comprehension or Full Mocks to unlock a +60 XP Scratch Card.',
    targetTests: 2,
    targetSubject: 'english',
    bonusXp: 60,
    dueDate: '2026-11-30',
    active: true,
  },
  {
    seedId: 'ssc_task_reas_speed',
    title: 'Reasoning Speed & Logic Target',
    description: 'Complete 2 Reasoning or Full Mock tests to claim +60 Bonus XP.',
    targetTests: 2,
    targetSubject: 'reasoning',
    bonusXp: 60,
    dueDate: '2026-11-30',
    active: true,
  },
  {
    seedId: 'ssc_task_weekly_arena',
    title: 'Weekly Cohort Consistency Goal',
    description: 'Finish 3 mock tests across any section this week for +100 Bonus XP.',
    targetTests: 3,
    targetSubject: 'all',
    bonusXp: 100,
    dueDate: '2026-11-30',
    active: true,
  },
  {
    seedId: 'ssc_task_tier1_marathon',
    title: 'SSC CGL Marathon Champion (5 Tests)',
    description: 'Attempt 5 mock tests across any SSC CGL section to unlock the +150 XP Mega Reward.',
    targetTests: 5,
    targetSubject: 'all',
    bonusXp: 150,
    dueDate: '2026-12-15',
    active: true,
  },
];
