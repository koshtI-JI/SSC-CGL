export type SubjectKey = 'quant' | 'reasoning' | 'english' | 'ga';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export type LanguageMode = 'en' | 'hi';

export interface ScoringConfig {
  pointsPerCorrect: number;
  negativeMarks: number;
  xpAttemptBase: number;
  xpPerCorrect: number;
  xpAccuracyThreshold: number;
  xpAccuracyBonus: number;
  updatedAt?: unknown;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  pointsPerCorrect: 2,
  negativeMarks: 0.5,
  xpAttemptBase: 10,
  xpPerCorrect: 2,
  xpAccuracyThreshold: 80,
  xpAccuracyBonus: 25,
};

export interface VipInvite {
  id: string;
  loginId: string;
  displayName: string;
  targetPost: string;
  slotNumber: number;
  active: boolean;
  passwordHash: string;
  /** Boolean-only indicator if a legacy remote record still holds a deprecated plaintext field; never exposes the secret. */
  legacyPlaintextDetected?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PhysicalChecklistState {
  height: boolean;
  walking: boolean;
  cycling: boolean;
}

export interface TopicMasteryEntry {
  topic: string;
  subject: SubjectKey;
  bestAccuracy: number;
  attempts: number;
  mastered: boolean;
  updatedAtMs: number;
}

export interface StudentProfile {
  uid: string;
  loginId: string;
  displayName: string;
  targetPost: string;
  slotNumber: number;
  cohortId: string;
  targetYear?: string;
  city?: string;
  bio?: string;
  avatarDataUrl?: string;
  physicalChecklist?: PhysicalChecklistState;
  syllabusMastery?: Record<string, TopicMasteryEntry>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  targetPost: string;
  cohortId: string;
  totalXp: number;
  testsAttempted: number;
  bestScore: number;
  avgAccuracy: number;
  totalTimeSec: number;
  updatedAt?: unknown;
}

export interface QuestionMetadata {
  exam: string;
  year: string;
  tier: string;
  shift: string;
}

export interface QuestionSchemaV2 {
  question_id: string;
  subject: string;
  topic: string;
  question_hi: string;
  question_en: string;
  options_hi: [string, string, string, string];
  options_en: [string, string, string, string];
  correct_answer_index: 0 | 1 | 2 | 3;
  metadata: QuestionMetadata;
  explanation_hi: string;
  explanation_en: string;
  short_trick: string;
}

export interface QuestionInput {
  subject: SubjectKey;
  topic: string;
  difficulty: DifficultyLevel;
  yearTag?: string;
  metadata?: QuestionMetadata;
  source: string;
  questionEn: string;
  questionHi?: string;
  optionsEn: [string, string, string, string];
  optionsHi?: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanationEn?: string;
  explanationHi?: string;
  shortTrick?: string;
}

export interface QuestionDoc extends QuestionInput {
  id: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MockTestDoc {
  id: string;
  title: string;
  subjectScope: 'full' | SubjectKey;
  durationMinutes: number;
  positiveMarks: number;
  negativeMarks: number;
  questionIds: string[];
  questionCount: number;
  published: boolean;
  createdBy: string;
  examMode?: 'standard' | 'tier1_sectional';
  topicTag?: string;
  sectionOrder?: SubjectKey[];
  sectionDurationSec?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SectionStat {
  correct: number;
  wrong: number;
  skipped: number;
  timeSec: number;
}

export type SectionStatsMap = Partial<Record<SubjectKey, SectionStat>>;

export interface TestAttemptDoc {
  id: string;
  uid: string;
  studentName: string;
  testId: string;
  testTitle: string;
  subjectScope: string;
  topicTag?: string;
  score: number;
  maxScore: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  totalTimeSec: number;
  xpEarned: number;
  sectionStats: SectionStatsMap;
  createdAt?: unknown;
}

export interface QuestionResponseState {
  questionId: string;
  visited: boolean;
  selectedIndex: number; // -1 if unanswered
  markedForReview: boolean;
  timeSpentSec: number;
}

export type PaletteStatus =
  | 'not_visited'
  | 'not_answered'
  | 'answered'
  | 'marked'
  | 'answered_marked';

export interface RevisionItemDoc {
  id: string;
  uid: string;
  questionId: string;
  testId: string;
  testTitle: string;
  subject: SubjectKey;
  lastSelectedIndex: number;
  mastered: boolean;
  aiDeepNote?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CohortTaskDoc {
  id: string;
  title: string;
  description: string;
  targetTests: number;
  targetSubject: 'all' | SubjectKey;
  bonusXp: number;
  dueDate: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface XpLedgerEntryDoc {
  id: string;
  uid: string;
  studentName: string;
  deltaXp: number;
  reason: string;
  sourceType: 'test' | 'task' | 'admin' | 'quiz_reward';
  refId: string;
  createdBy: string;
  createdAt?: unknown;
}

export type PresenceStatus = 'online' | 'in_exam' | 'offline';
export type CameraState = 'off' | 'ready' | 'streaming' | 'denied';
export type ProctorRoomStatus = 'idle' | 'requested' | 'offer_ready' | 'connected' | 'ended';

export interface StudentPresenceDoc {
  uid: string;
  displayName: string;
  loginId: string;
  status: PresenceStatus;
  cameraState: CameraState;
  currentTestId?: string;
  currentTestTitle?: string;
  questionIndex: number;
  totalQuestions: number;
  tabSwitchCount: number;
  lastSeenMs: number;
  snapshotDataUrl?: string;
  snapshotAtMs?: number;
  updatedAt?: unknown;
}

export interface ProctorRoomDoc {
  uid: string;
  sessionId: string;
  status: ProctorRoomStatus;
  offerSdp?: string;
  answerSdp?: string;
  requestedBy?: string;
  updatedAt?: unknown;
}

export interface ProctorCandidateDoc {
  id: string;
  sessionId: string;
  sender: 'student' | 'admin';
  candidateJson: string;
  createdAt?: unknown;
}

export interface StudentSessionLogDoc {
  id: string;
  uid: string;
  displayName: string;
  loginId: string;
  status: 'active' | 'ended';
  loginAtMs: number;
  lastActiveAtMs: number;
  logoutAtMs: number;
  activeDurationSec: number;
  testsCompleted: number;
  questionsAttempted: number;
  subjectsStudied: SubjectKey[];
  lastActivityTitle: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SubjectStudySummary {
  subject: SubjectKey;
  attemptedQuestions: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  accuracy: number;
  timeSec: number;
}

export interface StudentActivitySummary {
  uid: string;
  totalStudySec: number;
  totalStudyMinutes: number;
  sessionsCount: number;
  activeDays7d: number;
  totalQuestionsAttempted: number;
  subjectsCoveredCount: number;
  subjectBreakdown: Record<SubjectKey, SubjectStudySummary>;
  rewardMultiplier: number;
  tierLabel: 'Low Activity' | 'Regular' | 'Active Learner' | 'Dedicated' | 'Top Hustler';
  tierReason: string;
  nextMilestoneHint: string;
}

export interface TestDraftDoc {
  id: string;
  uid: string;
  testId: string;
  testTitle: string;
  subjectScope: string;
  currentIdx: number;
  secondsLeft: number;
  lang: LanguageMode;
  answeredCount: number;
  totalQuestions: number;
  responses: Record<string, QuestionResponseState>;
  sectionSecondsLeft?: Partial<Record<SubjectKey, number>>;
  activeSectionIdx?: number;
  examSessionId?: string;
  deadlineAtMs?: number;
  sectionDeadlineAtMs?: number;
  updatedAtMs: number;
  updatedAt?: unknown;
}

export interface ProgressBackupAttemptSummary {
  attemptId: string;
  testId: string;
  testTitle: string;
  subjectScope: string;
  score: number;
  maxScore: number;
  accuracy: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  xpEarned: number;
  totalTimeSec: number;
  isComplete: boolean;
  recordedAtMs: number;
}

export interface ProgressBackupDoc {
  id: string;
  uid: string;
  loginId: string;
  displayName: string;
  targetPost: string;
  slotNumber: number;
  totalXp: number;
  testsCompleted: number;
  totalSubmissions: number;
  bestScore: number;
  avgAccuracy: number;
  totalStudySec: number;
  attemptsHistory: ProgressBackupAttemptSummary[];
  updatedAtMs: number;
  updatedAt?: unknown;
}

export type SupportTicketStatus = 'open' | 'resolved';

export interface SupportTicketDoc {
  id: string;
  uid: string;
  loginId: string;
  studentName: string;
  targetPost: string;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  adminReply?: string;
  resolutionNotified: boolean;
  resolutionAcked: boolean;
  createdAtMs: number;
  resolvedAtMs: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AiProviderPreset = 'groq' | 'openai' | 'openrouter' | 'together' | 'custom';

export interface AiProviderConfig {
  provider: AiProviderPreset;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export type ReportedQueryStatus = 'open' | 'resolved';

export interface ReportedQueryQuestionSnapshot {
  subject: SubjectKey;
  topic: string;
  difficulty: DifficultyLevel;
  questionEn: string;
  questionHi?: string;
  optionsEn: [string, string, string, string];
  optionsHi?: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanationEn?: string;
  explanationHi?: string;
  shortTrick?: string;
}

export interface ReportedQueryDoc {
  id: string;
  uid: string;
  loginId: string;
  studentName: string;
  questionId: string;
  sourceContext: string;
  reason: string;
  aiExplanationSnapshot?: string;
  questionSnapshot: ReportedQueryQuestionSnapshot;
  status: ReportedQueryStatus;
  adminNotes?: string;
  createdAtMs: number;
  resolvedAtMs: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CorrectedQuestionOverrideDoc {
  id: string;
  questionId: string;
  subject: SubjectKey;
  topic: string;
  difficulty: DifficultyLevel;
  questionEn: string;
  questionHi?: string;
  optionsEn: [string, string, string, string];
  optionsHi?: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanationEn?: string;
  explanationHi?: string;
  shortTrick?: string;
  updatedBy: string;
  updatedAtMs: number;
  updatedAt?: unknown;
}

export const SUBJECT_LABELS: Record<SubjectKey, { en: string; hi: string; short: string }> = {
  quant: { en: 'Quantitative Aptitude', hi: 'गणित (अभिरुचि)', short: 'Quant' },
  reasoning: { en: 'General Intelligence & Reasoning', hi: 'तर्कशक्ति परीक्षण', short: 'Reasoning' },
  english: { en: 'English Comprehension', hi: 'अंग्रेजी बोधगम्यता', short: 'English' },
  ga: { en: 'General Awareness', hi: 'सामान्य जागरूकता', short: 'GA / GK' },
};
