import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  Flag,
  Globe,
  Headset,
  Languages,
  Layers,
  Plus,
  Save,
  Send,
  Settings,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  aiGenerateQuestions,
  aiTranslateBatch,
  fetchExternalQuestionsClient,
} from '../lib/aiClient';
import {
  addQuestionsBatch,
  addQuestionsBatchWithIds,
  adminAdjustLeaderboardXp,
  createCohortTask,
  createCustomMockFromBlueprintPaper,
  createMockTest,
  deleteCohortTask,
  deleteMockTest,
  deleteQuestion,
  ensureDailyAutomationSuite,
  fetchAllStudentsRevisionVaultsAdmin,
  resolveReportedQueryWithOverride,
  resolveSupportTicket,
  saveScoringConfig,
  seedStarterPackToFirestore,
  subscribePendingLocalSyncCount,
  toggleCohortTask,
  toggleMockTestPublish,
} from '../lib/firestoreService';
import {
  SUBJECT_LABELS,
  type CohortTaskDoc,
  type DifficultyLevel,
  type LeaderboardEntry,
  type MockTestDoc,
  type QuestionDoc,
  type QuestionInput,
  type ReportedQueryDoc,
  type RevisionItemDoc,
  type ScoringConfig,
  type StudentPresenceDoc,
  type StudentProfile,
  type StudentSessionLogDoc,
  type SubjectKey,
  type SupportTicketDoc,
  type TestAttemptDoc,
  type VipInvite,
  type XpLedgerEntryDoc,
} from '../types/exam';
import {
  assembleBlueprintCustomMock,
  buildPortableCustomMockJson,
  parsePortableCustomMockJson,
  type CustomMockBlueprintSlot,
} from '../utils/adminCommandCenter';
import { parseBulkCsvQuestions, parseBulkJsonQuestions } from '../utils/bulkParser';
import { MICRO_SYLLABUS_CHAPTERS } from '../utils/dreamPostCatalog';
import {
  buildDailySectionalTestId,
  DAILY_MOCK_PREFIX,
  formatDateTimeShort,
  getLocalDateKey,
  isPresenceOnline,
  toLocalDateKey,
} from '../utils/examEngine';
import { deriveMetadataFromSeedOrTag } from '../utils/questionSchema';
import { filterRealCohortRecords, isRealCohortStudentUid } from '../utils/sessionAndOverrides';
import { clearMemoryGithubToken } from '../utils/githubCodeEditor';
import { AdminCohortProgressSection } from './AdminCohortProgressSection';
import { AdminLiveProctorPanel } from './AdminLiveProctorPanel';
import { AdminPdfIngestor } from './AdminPdfIngestor';
import { AdminUserManagementTab } from './AdminUserManagementTab';
import { DynamicSettingsManagerPanel } from './DynamicSettingsManagerPanel';
import { LeaderboardPanel } from './LeaderboardPanel';
import { LiveCodeEditorPanel } from './LiveCodeEditorPanel';
import { NotificationBell } from './NotificationBell';
import { PdfQuestionExtractor } from './PdfQuestionExtractor';
import { TopNav } from './TopNav';
import { WipeQuestionsModal } from './WipeQuestionsModal';

interface AdminControlCenterProps {
  adminUid: string;
  adminEmail: string;
  invites: VipInvite[];
  invitesLoaded?: boolean;
  students: StudentProfile[];
  presences: StudentPresenceDoc[];
  sessionLogs: StudentSessionLogDoc[];
  leaderboard: LeaderboardEntry[];
  questions: QuestionDoc[];
  tests: MockTestDoc[];
  attempts: TestAttemptDoc[];
  tasks: CohortTaskDoc[];
  xpLedger: XpLedgerEntryDoc[];
  scoringConfig: ScoringConfig;
  brandName?: string;
  githubReportsEnabled?: boolean;
  supportTickets?: SupportTicketDoc[];
  reportedQueries?: ReportedQueryDoc[];
  onPreviewAsStudent: () => void;
  onAdminIdUpdated?: (nextAdminId: string) => void;
  onOpenAiSettings?: () => void;
  onSignOut: () => void;
}

type AdminTab =
  | 'analytics'
  | 'proctoring'
  | 'cohort'
  | 'gamification'
  | 'settings'
  | 'github-editor'
  | 'questions'
  | 'pdf-ingestor'
  | 'pdf-auto-extractor'
  | 'tests'
  | 'tickets'
  | 'reports';

const JSON_FORMAT_EXAMPLE = `[
  {
    "question_id": "cgl_2023_t1_s2_trig_01",
    "subject": "Mathematics",
    "topic": "Trigonometry",
    "question_hi": "यदि sin θ = 3/5 है, तो tan θ का मान ज्ञात कीजिए।",
    "question_en": "If sin θ = 3/5, find the value of tan θ.",
    "options_hi": ["4/3", "3/4", "4/5", "5/4"],
    "options_en": ["4/3", "3/4", "4/5", "5/4"],
    "correct_answer_index": 1,
    "metadata": {
      "exam": "SSC CGL",
      "year": "2023",
      "tier": "Tier-1",
      "shift": "Shift-2"
    },
    "explanation_hi": "समकोण त्रिभुज में लम्ब = 3, कर्ण = 5 ⇒ आधार = 4, अतः tan θ = 3/4।",
    "explanation_en": "In a right triangle, P = 3, H = 5 ⇒ B = 4, so tan θ = 3/4.",
    "short_trick": "3-4-5 Pythagorean triplet ⇒ tan θ = P/B = 3/4."
  }
]`;

const CSV_FORMAT_EXAMPLE = `subject,topic,difficulty,yearTag,questionEn,questionHi,optionA,optionB,optionC,optionD,answer,explanationEn
ga,Polity,medium,CGL 2024,"Which article covers Right to Equality?",,"Article 14","Article 19","Article 21","Article 32",A,"Article 14 guarantees equality before law."`;

export const AdminControlCenter: React.FC<AdminControlCenterProps> = ({
  adminUid,
  adminEmail,
  invites,
  invitesLoaded = true,
  students,
  presences,
  sessionLogs,
  leaderboard,
  questions,
  tests,
  attempts,
  tasks,
  xpLedger,
  scoringConfig,
  brandName = 'Path to CGL',
  githubReportsEnabled = true,
  supportTickets = [],
  reportedQueries = [],
  onPreviewAsStudent,
  onAdminIdUpdated,
  onOpenAiSettings,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('analytics');
  const [tabHistory, setTabHistory] = useState<AdminTab[]>([]);
  const [bannerMsg, setBannerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});
  const [resolvingTicketId, setResolvingTicketId] = useState<string | null>(null);
  const [resolvingReportId, setResolvingReportId] = useState<string | null>(null);
  const [reportDrafts, setReportDrafts] = useState<
    Record<
      string,
      {
        subject: SubjectKey;
        topic: string;
        difficulty: DifficultyLevel;
        questionEn: string;
        questionHi: string;
        optionsEn: [string, string, string, string];
        optionsHi: [string, string, string, string];
        correctIndex: 0 | 1 | 2 | 3;
        explanationEn: string;
        explanationHi: string;
        shortTrick: string;
        adminNotes: string;
      }
    >
  >({});

  const navigateAdminTab = (next: AdminTab) => {
    if (next !== activeTab) {
      setTabHistory((prev) => [...prev.slice(-8), activeTab]);
      setActiveTab(next);
    }
    setBannerMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackAdminTab = () => {
    const prevTab = tabHistory[tabHistory.length - 1] ?? 'analytics';
    setTabHistory((prev) => prev.slice(0, -1));
    setActiveTab(prevTab === activeTab ? 'analytics' : prevTab);
    setBannerMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [revisionVaultByUid, setRevisionVaultByUid] = useState<Record<string, RevisionItemDoc[]>>({});

  // Blueprint Custom Mock JSON Builder State
  const [bpTitle, setBpTitle] = useState('Chapter Blueprint Mock');
  const [bpDuration, setBpDuration] = useState('30');
  const [bpPosMarks, setBpPosMarks] = useState(String(scoringConfig.pointsPerCorrect));
  const [bpNegMarks, setBpNegMarks] = useState(String(scoringConfig.negativeMarks));
  const [bpSlotSubject, setBpSlotSubject] = useState<SubjectKey>('quant');
  const [bpSlotTopic, setBpSlotTopic] = useState('quant_percentage');
  const [bpSlotCount, setBpSlotCount] = useState('5');
  const [bpSlots, setBpSlots] = useState<CustomMockBlueprintSlot[]>([
    { subject: 'quant', chapterSlugOrTopic: 'quant_percentage', count: 5 },
    { subject: 'ga', chapterSlugOrTopic: 'ga_polity', count: 5 },
  ]);
  const [bpBusy, setBpBusy] = useState(false);
  const bpImportInputRef = useRef<HTMLInputElement | null>(null);

  const bpAssembled = useMemo(
    () =>
      assembleBlueprintCustomMock({
        allQuestions: questions,
        slots: bpSlots,
        seedKey: bpTitle || 'blueprint',
      }),
    [questions, bpSlots, bpTitle]
  );

  const realInvites = useMemo(
    () => invites.filter((i) => isRealCohortStudentUid(i.id)),
    [invites]
  );
  const realVipUids = useMemo(
    () => new Set(realInvites.map((i) => i.id)),
    [realInvites]
  );
  const realStudents = useMemo(
    () => filterRealCohortRecords(students, (s) => s.uid, realVipUids),
    [students, realVipUids]
  );
  const realPresences = useMemo(
    () => filterRealCohortRecords(presences, (p) => p.uid, realVipUids),
    [presences, realVipUids]
  );
  const realSessionLogs = useMemo(
    () => filterRealCohortRecords(sessionLogs, (s) => s.uid, realVipUids),
    [sessionLogs, realVipUids]
  );
  const realLeaderboard = useMemo(
    () => filterRealCohortRecords(leaderboard, (l) => l.uid, realVipUids),
    [leaderboard, realVipUids]
  );
  const realAttempts = useMemo(
    () => filterRealCohortRecords(attempts, (a) => a.uid, realVipUids),
    [attempts, realVipUids]
  );
  const realXpLedger = useMemo(
    () => filterRealCohortRecords(xpLedger, (x) => x.uid, realVipUids),
    [xpLedger, realVipUids]
  );

  React.useEffect(() => {
    return subscribePendingLocalSyncCount(setPendingSyncCount);
  }, []);

  useEffect(() => {
    if (activeTab !== 'analytics') return;
    const uids = Array.from(
      new Set([...realInvites.map((i) => i.id), ...realStudents.map((s) => s.uid)])
    );
    if (uids.length === 0) return;
    let alive = true;
    void fetchAllStudentsRevisionVaultsAdmin(uids)
      .then((res) => {
        if (alive) setRevisionVaultByUid(res);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [activeTab, realInvites, realStudents]);

  // Gamification / Scoring Formula / Tasks / Manual XP
  const [formulaDraft, setFormulaDraft] = useState<ScoringConfig>(scoringConfig);
  React.useEffect(() => {
    setFormulaDraft(scoringConfig);
  }, [scoringConfig]);

  const [adjUid, setAdjUid] = useState('');
  const [adjDelta, setAdjDelta] = useState('25');
  const [adjReason, setAdjReason] = useState('');

  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskTargetTests, setTaskTargetTests] = useState('2');
  const [taskSubject, setTaskSubject] = useState<'all' | SubjectKey>('ga');
  const [taskBonusXp, setTaskBonusXp] = useState('50');
  const [taskDueDate, setTaskDueDate] = useState(() => toLocalDateKey(Date.now() + 7 * 86_400_000));

  // External Question API + Bulk Upload
  const [extProvider, setExtProvider] = useState<'opentdb' | 'custom_url'>('opentdb');
  const [extSubject, setExtSubject] = useState<SubjectKey>('ga');
  const [extCategory, setExtCategory] = useState('9');
  const [extAmount, setExtAmount] = useState('10');
  const [extCustomUrl, setExtCustomUrl] = useState('');
  const [extCustomKey, setExtCustomKey] = useState('');
  const [extHeaderName, setExtHeaderName] = useState('Authorization');
  const [extPreview, setExtPreview] = useState<QuestionInput[]>([]);
  const [extBusy, setExtBusy] = useState(false);

  const [bulkMode, setBulkMode] = useState<'json' | 'csv'>('json');
  const [bulkText, setBulkText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<ReturnType<typeof parseBulkJsonQuestions> | null>(null);
  const [qFilterSubject, setQFilterSubject] = useState<'all' | SubjectKey>('all');
  const [qSearch, setQSearch] = useState('');

  // Single Manual Question Creator
  const [mqSubject, setMqSubject] = useState<SubjectKey>('quant');
  const [mqTopic, setMqTopic] = useState('Percentage');
  const [mqDifficulty, setMqDifficulty] = useState<DifficultyLevel>('medium');
  const [mqYearTag, setMqYearTag] = useState('SSC CGL 2024');
  const [mqQuestionEn, setMqQuestionEn] = useState('');
  const [mqQuestionHi, setMqQuestionHi] = useState('');
  const [mqOptsEn, setMqOptsEn] = useState<[string, string, string, string]>(['', '', '', '']);
  const [mqOptsHi, setMqOptsHi] = useState<[string, string, string, string]>(['', '', '', '']);
  const [mqCorrectIdx, setMqCorrectIdx] = useState<0 | 1 | 2 | 3>(0);
  const [mqExplEn, setMqExplEn] = useState('');
  const [mqShortTrick, setMqShortTrick] = useState('');
  const [mqBusy, setMqBusy] = useState(false);

  // AI Question Generator
  const [aiSubject, setAiSubject] = useState<SubjectKey>('quant');
  const [aiTopic, setAiTopic] = useState('Profit & Loss');
  const [aiDifficulty, setAiDifficulty] = useState<DifficultyLevel>('medium');
  const [aiCount, setAiCount] = useState('5');
  const [aiPreview, setAiPreview] = useState<QuestionInput[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [wipeQuestionsModalOpen, setWipeQuestionsModalOpen] = useState(false);

  // Test Composer
  const [testTitle, setTestTitle] = useState('');
  const [testScope, setTestScope] = useState<'full' | SubjectKey>('full');
  const [testDuration, setTestDuration] = useState('60');
  const [testPosMarks, setTestPosMarks] = useState(String(scoringConfig.pointsPerCorrect));
  const [testNegMarks, setTestNegMarks] = useState(String(scoringConfig.negativeMarks));
  const [selectedQIds, setSelectedQIds] = useState<string[]>([]);
  const [composerSubjectFilter, setComposerSubjectFilter] = useState<'all' | SubjectKey>('all');
  const [weeklyAutoBusy, setWeeklyAutoBusy] = useState(false);

  const notify = (type: 'ok' | 'err', text: string) => {
    setBannerMsg({ type, text });
  };

  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (qFilterSubject !== 'all' && q.subject !== qFilterSubject) return false;
      if (qSearch.trim()) {
        const needle = qSearch.trim().toLowerCase();
        return (
          q.questionEn.toLowerCase().includes(needle) ||
          q.topic.toLowerCase().includes(needle) ||
          q.source.toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [questions, qFilterSubject, qSearch]);

  const handleSaveFormula = async (e: React.FormEvent) => {
    e.preventDefault();
    const safeFormula: ScoringConfig = {
      pointsPerCorrect:
        Number.isFinite(formulaDraft.pointsPerCorrect) && formulaDraft.pointsPerCorrect >= 0
          ? formulaDraft.pointsPerCorrect
          : scoringConfig.pointsPerCorrect,
      negativeMarks:
        Number.isFinite(formulaDraft.negativeMarks) && formulaDraft.negativeMarks >= 0
          ? formulaDraft.negativeMarks
          : scoringConfig.negativeMarks,
      xpAttemptBase:
        Number.isFinite(formulaDraft.xpAttemptBase) && formulaDraft.xpAttemptBase >= 0
          ? Math.round(formulaDraft.xpAttemptBase)
          : scoringConfig.xpAttemptBase,
      xpPerCorrect:
        Number.isFinite(formulaDraft.xpPerCorrect) && formulaDraft.xpPerCorrect >= 0
          ? Math.round(formulaDraft.xpPerCorrect)
          : scoringConfig.xpPerCorrect,
      xpAccuracyThreshold:
        Number.isFinite(formulaDraft.xpAccuracyThreshold) &&
        formulaDraft.xpAccuracyThreshold >= 0 &&
        formulaDraft.xpAccuracyThreshold <= 100
          ? Math.round(formulaDraft.xpAccuracyThreshold)
          : scoringConfig.xpAccuracyThreshold,
      xpAccuracyBonus:
        Number.isFinite(formulaDraft.xpAccuracyBonus) && formulaDraft.xpAccuracyBonus >= 0
          ? Math.round(formulaDraft.xpAccuracyBonus)
          : scoringConfig.xpAccuracyBonus,
    };
    try {
      await saveScoringConfig(safeFormula);
      notify('ok', 'Dynamic XP & Marking Formula updated across all live tests.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to save formula.');
    }
  };

  const handleAdjustXp = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = realLeaderboard.find((l) => l.uid === adjUid) ?? realLeaderboard[0];
    const delta = Number(adjDelta);
    if (!target || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 5000 || adjReason.trim().length < 2) {
      notify('err', 'Select a student, enter non-zero XP delta (-5000 to +5000), and provide a reason (min 2 chars).');
      return;
    }
    try {
      await adminAdjustLeaderboardXp({
        adminUid,
        targetEntry: target,
        deltaXp: delta,
        reason: adjReason,
      });
      setAdjReason('');
      notify('ok', `Adjusted ${target.displayName} by ${delta >= 0 ? `+${delta}` : delta} XP.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to adjust XP.');
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !taskDesc.trim()) {
      notify('err', 'Task title and description are required.');
      return;
    }
    try {
      const parsedTarget = Number(taskTargetTests);
      const parsedBonus = Number(taskBonusXp);
      await createCohortTask({
        title: taskTitle,
        description: taskDesc,
        targetTests: Number.isFinite(parsedTarget) && parsedTarget >= 1 ? Math.round(parsedTarget) : 1,
        targetSubject: taskSubject,
        bonusXp: Number.isFinite(parsedBonus) && parsedBonus >= 1 ? Math.round(parsedBonus) : 25,
        dueDate: taskDueDate,
        active: true,
      });
      setTaskTitle('');
      setTaskDesc('');
      notify('ok', 'Cohort task published to all 5 VIP students.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to create task.');
    }
  };

  const handleFetchExternalQuestions = async () => {
    setExtBusy(true);
    setBannerMsg(null);
    try {
      const data = await fetchExternalQuestionsClient({
        provider: extProvider as 'opentdb' | 'custom_url',
        amount: Number(extAmount) || 10,
        subject: extSubject,
        category: extCategory,
        customUrl: extCustomUrl,
        customApiKey: extCustomKey,
        customHeaderName: extHeaderName,
      });
      setExtPreview(data.questions || []);
      notify('ok', `Fetched ${(data.questions || []).length} live questions from ${data.fetchedFrom}.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to fetch external questions.');
    } finally {
      setExtBusy(false);
    }
  };

  const handleTranslateExtPreview = async () => {
    if (extPreview.length === 0) return;
    setExtBusy(true);
    try {
      const data = await aiTranslateBatch({ questions: extPreview });
      const byIndex = new Map<number, { questionHi: string; optionsHi: string[]; explanationHi: string }>();
      for (const t of data.translations || []) {
        byIndex.set(t.index, t);
      }
      setExtPreview((prev) =>
        prev.map((q, idx) => {
          const tr = byIndex.get(idx);
          if (!tr || !Array.isArray(tr.optionsHi) || tr.optionsHi.length !== 4) return q;
          return {
            ...q,
            questionHi: tr.questionHi,
            optionsHi: tr.optionsHi as [string, string, string, string],
            explanationHi: tr.explanationHi,
          };
        })
      );
      notify('ok', 'Added Hindi translations to fetched questions.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Translation failed.');
    } finally {
      setExtBusy(false);
    }
  };

  const handleCommitExtPreview = async () => {
    if (extPreview.length === 0) return;
    setExtBusy(true);
    try {
      const count = await addQuestionsBatch(extPreview, adminUid);
      setExtPreview([]);
      notify('ok', `Saved ${count} live external questions to Firestore Question Bank.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to save questions.');
    } finally {
      setExtBusy(false);
    }
  };

  const handleValidateBulk = () => {
    const parsed =
      bulkMode === 'json' ? parseBulkJsonQuestions(bulkText) : parseBulkCsvQuestions(bulkText);
    setBulkPreview(parsed);
  };

  const handleCommitBulk = async () => {
    if (!bulkPreview || bulkPreview.valid.length === 0) return;
    try {
      const count = await addQuestionsBatch(bulkPreview.valid, adminUid);
      setBulkPreview(null);
      setBulkText('');
      notify('ok', `Uploaded ${count} validated PYQs to Firestore Question Bank.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Bulk upload failed.');
    }
  };

  const handleSaveManualQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mqQuestionEn.trim() || mqOptsEn.some((o) => !o.trim())) {
      notify('err', 'Question text (English) and all 4 options are required.');
      return;
    }
    setMqBusy(true);
    try {
      const hasAllHindiOpts = mqOptsHi.every((o) => o.trim().length > 0);
      const parsedMeta = deriveMetadataFromSeedOrTag(mqYearTag.trim() || 'SSC CGL 2023 Tier-1 | Shift-1');
      const qInput: QuestionInput = {
        subject: mqSubject,
        topic: mqTopic.trim() || 'General',
        difficulty: mqDifficulty,
        yearTag: mqYearTag.trim() || undefined,
        metadata: parsedMeta,
        source: 'Admin Manual Entry',
        questionEn: mqQuestionEn.trim(),
        ...(mqQuestionHi.trim() ? { questionHi: mqQuestionHi.trim() } : {}),
        optionsEn: mqOptsEn.map((o) => o.trim()) as [string, string, string, string],
        ...(hasAllHindiOpts
          ? { optionsHi: mqOptsHi.map((o) => o.trim()) as [string, string, string, string] }
          : {}),
        correctIndex: mqCorrectIdx,
        ...(mqExplEn.trim() ? { explanationEn: mqExplEn.trim() } : {}),
        ...(mqShortTrick.trim() ? { shortTrick: mqShortTrick.trim() } : {}),
      };
      await addQuestionsBatch([qInput], adminUid);
      setMqQuestionEn('');
      setMqQuestionHi('');
      setMqOptsEn(['', '', '', '']);
      setMqOptsHi(['', '', '', '']);
      setMqExplEn('');
      setMqShortTrick('');
      notify('ok', 'Added 1 new question to the live Firestore Question Bank.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Could not save question.');
    } finally {
      setMqBusy(false);
    }
  };

  const handleGenerateAiQuestions = async () => {
    setAiBusy(true);
    setBannerMsg(null);
    try {
      const data = await aiGenerateQuestions({
        subject: aiSubject,
        topic: aiTopic,
        difficulty: aiDifficulty,
        count: Number(aiCount) || 5,
      });
      setAiPreview(data.questions || []);
      notify('ok', `Generated ${(data.questions || []).length} bilingual SSC CGL questions. Review and click Save to Firestore.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to generate AI questions.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleCommitAiQuestions = async () => {
    if (aiPreview.length === 0) return;
    setAiBusy(true);
    try {
      const count = await addQuestionsBatch(aiPreview, adminUid);
      setAiPreview([]);
      notify('ok', `Saved ${count} AI-generated bilingual questions to Firestore Question Bank.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to save AI questions.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleSeedStarterPack = async () => {
    setSeedBusy(true);
    try {
      const res = await seedStarterPackToFirestore(adminUid);
      notify(
        'ok',
        `Starter Pack synced: +${res.questionsAdded} questions, +${res.testsAdded} mock tests, +${res.tasksAdded} targets.`
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Starter pack sync failed.');
    } finally {
      setSeedBusy(false);
    }
  };

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTitle.trim() || selectedQIds.length === 0) {
      notify('err', 'Provide a test title and select at least 1 question.');
      return;
    }
    try {
      const parsedPos = Number(testPosMarks);
      const parsedNeg = Number(testNegMarks);
      const parsedDur = Number(testDuration);
      const positiveMarks =
        testPosMarks.trim() !== '' && Number.isFinite(parsedPos) && parsedPos >= 0
          ? parsedPos
          : scoringConfig.pointsPerCorrect;
      const negativeMarks =
        testNegMarks.trim() !== '' && Number.isFinite(parsedNeg) && parsedNeg >= 0
          ? parsedNeg
          : scoringConfig.negativeMarks;
      await createMockTest({
        title: testTitle,
        subjectScope: testScope,
        durationMinutes: Number.isFinite(parsedDur) && parsedDur >= 1 ? Math.round(parsedDur) : 60,
        positiveMarks,
        negativeMarks,
        questionIds: selectedQIds,
        published: true,
        createdBy: adminUid,
      });
      setTestTitle('');
      setSelectedQIds([]);
      notify('ok', 'Mock test published live to the 5 VIP students.');
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to publish test.');
    }
  };

  const onlineProctorCount = useMemo(
    () => realPresences.filter((p) => isPresenceOnline(p)).length,
    [realPresences]
  );

  const cohortTests = useMemo(
    () => tests.filter((t) => !t.id.startsWith('prac_')),
    [tests]
  );

  const openTicketsCount = useMemo(
    () => supportTickets.filter((t) => t.status === 'open').length,
    [supportTickets]
  );

  const sortedTickets = useMemo(
    () =>
      [...supportTickets].sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        return b.createdAtMs - a.createdAtMs;
      }),
    [supportTickets]
  );

  const openReportsCount = useMemo(
    () => reportedQueries.filter((r) => r.status === 'open').length,
    [reportedQueries]
  );

  const sortedReports = useMemo(
    () =>
      [...reportedQueries].sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        return b.createdAtMs - a.createdAtMs;
      }),
    [reportedQueries]
  );

  const questionsById = useMemo(() => {
    const map = new Map<string, QuestionDoc>();
    for (const q of questions) {
      map.set(q.id, q);
    }
    return map;
  }, [questions]);

  const getReportDraft = (rep: ReportedQueryDoc) => {
    if (reportDrafts[rep.id]) return reportDrafts[rep.id];
    const bankQ = questionsById.get(rep.questionId);
    const snap = rep.questionSnapshot;
    const optsEnRaw = bankQ?.optionsEn ?? snap?.optionsEn ?? ['', '', '', ''];
    const optsHiRaw = bankQ?.optionsHi ?? snap?.optionsHi ?? ['', '', '', ''];
    return {
      subject: bankQ?.subject ?? snap?.subject ?? 'quant',
      topic: bankQ?.topic ?? snap?.topic ?? 'General',
      difficulty: bankQ?.difficulty ?? snap?.difficulty ?? 'medium',
      questionEn: bankQ?.questionEn ?? snap?.questionEn ?? '',
      questionHi: bankQ?.questionHi ?? snap?.questionHi ?? '',
      optionsEn: [
        optsEnRaw[0] ?? '',
        optsEnRaw[1] ?? '',
        optsEnRaw[2] ?? '',
        optsEnRaw[3] ?? '',
      ] as [string, string, string, string],
      optionsHi: [
        optsHiRaw[0] ?? '',
        optsHiRaw[1] ?? '',
        optsHiRaw[2] ?? '',
        optsHiRaw[3] ?? '',
      ] as [string, string, string, string],
      correctIndex: (bankQ?.correctIndex ?? snap?.correctIndex ?? 0) as 0 | 1 | 2 | 3,
      explanationEn: bankQ?.explanationEn ?? snap?.explanationEn ?? '',
      explanationHi: bankQ?.explanationHi ?? snap?.explanationHi ?? '',
      shortTrick: bankQ?.shortTrick ?? snap?.shortTrick ?? '',
      adminNotes: rep.adminNotes ?? '',
    };
  };

  const patchReportDraft = (
    rep: ReportedQueryDoc,
    patch: Partial<ReturnType<typeof getReportDraft>>
  ) => {
    setReportDrafts((prev) => ({
      ...prev,
      [rep.id]: {
        ...getReportDraft(rep),
        ...patch,
      },
    }));
  };

  const handleSaveReportOverride = async (rep: ReportedQueryDoc) => {
    const draft = getReportDraft(rep);
    setResolvingReportId(rep.id);
    try {
      await resolveReportedQueryWithOverride({
        reportId: rep.id,
        questionId: rep.questionId,
        updatedBy: adminEmail || adminUid,
        override: {
          subject: draft.subject,
          topic: draft.topic,
          difficulty: draft.difficulty,
          questionEn: draft.questionEn,
          ...(draft.questionHi.trim() ? { questionHi: draft.questionHi.trim() } : {}),
          optionsEn: draft.optionsEn,
          ...(draft.optionsHi.every((o) => o.trim().length > 0) ? { optionsHi: draft.optionsHi } : {}),
          correctIndex: draft.correctIndex,
          ...(draft.explanationEn.trim() ? { explanationEn: draft.explanationEn.trim() } : {}),
          ...(draft.explanationHi.trim() ? { explanationHi: draft.explanationHi.trim() } : {}),
          ...(draft.shortTrick.trim() ? { shortTrick: draft.shortTrick.trim() } : {}),
        },
        adminNotes: draft.adminNotes,
      });
      notify(
        'ok',
        `Saved global answer/solution override for "${rep.questionId}" and resolved report from ${rep.studentName}.`
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to save question override.');
    } finally {
      setResolvingReportId(null);
    }
  };

  const handleResolveTicket = async (ticket: SupportTicketDoc) => {
    setResolvingTicketId(ticket.id);
    try {
      await resolveSupportTicket(ticket.id, ticketReplies[ticket.id] ?? '');
      notify('ok', `Ticket resolved for ${ticket.studentName}. Push notification sent.`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Failed to resolve ticket.');
    } finally {
      setResolvingTicketId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6f8] dark:bg-[#11151d] text-slate-900 dark:text-slate-100">
      <TopNav
        brandName={brandName}
        tabs={[
          { id: 'analytics', label: 'Analytics' },
          {
            id: 'proctoring',
            label: onlineProctorCount > 0 ? `Proctoring (${onlineProctorCount})` : 'Proctoring',
          },
          { id: 'cohort', label: `VIP (${realInvites.length}/5)` },
          { id: 'gamification', label: 'XP & Formula' },
          { id: 'questions', label: `Q-Bank (${questions.length})` },
          { id: 'pdf-ingestor', label: 'PDF Ingest' },
          { id: 'pdf-auto-extractor', label: 'Extractor' },
          { id: 'tests', label: `Tests (${cohortTests.length})` },
          {
            id: 'reports',
            label: openReportsCount > 0 ? `Reports (${openReportsCount})` : 'Reports',
          },
          {
            id: 'tickets',
            label: openTicketsCount > 0 ? `Tickets (${openTicketsCount})` : 'Tickets',
          },
          { id: 'settings', label: 'Settings' },
          { id: 'github-editor', label: 'Repo CMS' },
        ]}
        activeTab={activeTab}
        backButton={
          activeTab !== 'analytics'
            ? { label: 'Back', onClick: handleBackAdminTab }
            : null
        }
        notificationSlot={
          <NotificationBell
            tests={tests}
            tasks={tasks}
            onNavigateTab={(tabId) => {
              if (tabId === 'overview') navigateAdminTab('tests');
            }}
          />
        }
        onSelectTab={(id) => navigateAdminTab(id as AdminTab)}
        onOpenAiSettings={onOpenAiSettings}
        onSignOut={() => {
          clearMemoryGithubToken();
          onSignOut();
        }}
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Super Admin Control Center · Signed in as {adminEmail}
            </p>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
              Cohort Telemetry &amp; Content Operations
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
              {realStudents.length} active VIPs · {questions.length} live questions · {realAttempts.length} attempts
            </span>
            <button
              type="button"
              onClick={onPreviewAsStudent}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <Eye className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <span>Preview Student View</span>
            </button>
          </div>
        </div>

        {activeTab !== 'analytics' && (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleBackAdminTab}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back to {tabHistory.length > 0 ? 'Previous Tab' : 'Deep Analytics'}</span>
            </button>
          </div>
        )}

        {bannerMsg && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm font-medium ${
              bannerMsg.type === 'ok'
                ? 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/35 text-emerald-900 dark:text-emerald-200'
                : 'border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/35 text-red-900 dark:text-red-200'
            }`}
          >
            {bannerMsg.text}
          </div>
        )}

        {/* 1. DEEP ANALYTICS */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <LeaderboardPanel
              entries={realLeaderboard}
              recentLedger={realXpLedger}
              sessionLogs={realSessionLogs}
            />

            <AdminCohortProgressSection
              invites={realInvites}
              students={realStudents}
              leaderboard={realLeaderboard}
              attempts={realAttempts}
              sessionLogs={realSessionLogs}
              questions={questions}
              revisionVaultByUid={revisionVaultByUid}
              githubReportsEnabled={githubReportsEnabled}
            />
          </div>
        )}

        {/* LIVE CAMERA & EXAM PROCTORING */}
        {activeTab === 'proctoring' && (
          <AdminLiveProctorPanel
            adminUid={adminUid}
            invites={realInvites}
            students={realStudents}
            presences={realPresences}
          />
        )}

        {/* 2. VIP COHORT (5 SLOTS) + ADMIN SECURITY */}
        {activeTab === 'cohort' && (
          <AdminUserManagementTab
            adminEmail={adminEmail}
            invites={realInvites}
            invitesLoaded={invitesLoaded}
            students={realStudents}
            leaderboard={realLeaderboard}
            attempts={realAttempts}
            presences={realPresences}
            pendingSyncCount={pendingSyncCount}
            onAdminIdUpdated={onAdminIdUpdated}
            onOpenAiSettings={onOpenAiSettings}
            onNotify={notify}
          />
        )}

        {/* 3. GAMIFICATION: DYNAMIC XP FORMULA, MANUAL ADJUSTMENT, TASKS */}
        {activeTab === 'gamification' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <form
              onSubmit={handleSaveFormula}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4 lg:col-span-5"
            >
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Dynamic XP &amp; Marking Formula
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Adjust these multipliers anytime; all future test submissions compute XP and default marks using these live rules.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cfg-pos" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Default +Marks / Correct
                  </label>
                  <input
                    id="cfg-pos"
                    type="number"
                    step="0.5"
                    value={formulaDraft.pointsPerCorrect}
                    onChange={(e) =>
                      setFormulaDraft({ ...formulaDraft, pointsPerCorrect: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="cfg-neg" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Default -Negative / Wrong
                  </label>
                  <input
                    id="cfg-neg"
                    type="number"
                    step="0.25"
                    value={formulaDraft.negativeMarks}
                    onChange={(e) =>
                      setFormulaDraft({ ...formulaDraft, negativeMarks: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="cfg-base" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Attempt Base XP
                  </label>
                  <input
                    id="cfg-base"
                    type="number"
                    value={formulaDraft.xpAttemptBase}
                    onChange={(e) =>
                      setFormulaDraft({ ...formulaDraft, xpAttemptBase: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="cfg-per-corr" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    XP per Correct Answer
                  </label>
                  <input
                    id="cfg-per-corr"
                    type="number"
                    value={formulaDraft.xpPerCorrect}
                    onChange={(e) =>
                      setFormulaDraft({ ...formulaDraft, xpPerCorrect: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="cfg-acc-thr" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Accuracy Bonus Threshold %
                  </label>
                  <input
                    id="cfg-acc-thr"
                    type="number"
                    value={formulaDraft.xpAccuracyThreshold}
                    onChange={(e) =>
                      setFormulaDraft({
                        ...formulaDraft,
                        xpAccuracyThreshold: Number(e.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="cfg-acc-bon" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    High Accuracy Bonus XP
                  </label>
                  <input
                    id="cfg-acc-bon"
                    type="number"
                    value={formulaDraft.xpAccuracyBonus}
                    onChange={(e) =>
                      setFormulaDraft({ ...formulaDraft, xpAccuracyBonus: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-blue-700 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                Save Live Scoring Formula
              </button>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-4 space-y-2">
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Activity-Weighted Reward Multiplier (Auto-Scaled)
                </p>
                <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  Mock Test XP and Scratch-Card Task Bonuses automatically scale by how active each student is and how many subjects they study:
                </p>
                <ul className="space-y-1 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                  <li>0.85x Low Activity (&lt;10m study, &lt;15 Qs)</li>
                  <li>1.00x Regular (baseline activity)</li>
                  <li>1.15x Active Learner (20m+ study &amp; 2+ subjects / 20+ Qs)</li>
                  <li>1.25x Dedicated (45m+ study, 3+ subjects, 30+ Qs)</li>
                  <li>1.40x Top Hustler (90m+ study, all 4 subjects, 2+ days, 60+ Qs)</li>
                </ul>
              </div>
            </form>

            <div className="space-y-6 lg:col-span-7">
              {/* Manual Leaderboard XP Adjustment */}
              <form
                onSubmit={handleAdjustXp}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4"
              >
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Leaderboard XP Adjustment (Audited)
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <select
                    aria-label="Select student for XP adjustment"
                    value={adjUid || realLeaderboard[0]?.uid || ''}
                    onChange={(e) => setAdjUid(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#11151d] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    {realLeaderboard.length === 0 ? (
                      <option value="">No active students</option>
                    ) : (
                      realLeaderboard.map((l) => (
                        <option key={l.uid} value={l.uid}>
                          {l.displayName} ({l.totalXp} XP)
                        </option>
                      ))
                    )}
                  </select>
                  <input
                    type="number"
                    aria-label="XP Delta"
                    value={adjDelta}
                    onChange={(e) => setAdjDelta(e.target.value)}
                    placeholder="+25 or -10"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="text"
                    aria-label="Adjustment Reason"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    placeholder="Reason (e.g. Daily streak bonus)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
                <button
                  type="submit"
                  disabled={realLeaderboard.length === 0}
                  className="rounded-lg bg-slate-900 dark:bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 disabled:opacity-50 cursor-pointer"
                >
                  Apply XP Adjustment
                </button>
              </form>

              {/* Task Manager */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Daily &amp; Weekly Bonus Tasks
                </h2>
                <form onSubmit={handleCreateTask} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="Task Title (e.g. GS Sprint)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="text"
                    value={taskDesc}
                    onChange={(e) => setTaskDesc(e.target.value)}
                    placeholder="Give 2 GS Quizzes today to earn 50 Bonus XP"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                  <div className="flex gap-2">
                    <select
                      aria-label="Target Subject"
                      value={taskSubject}
                      onChange={(e) => setTaskSubject(e.target.value as 'all' | SubjectKey)}
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="all">All Subjects</option>
                      <option value="quant">Quant</option>
                      <option value="reasoning">Reasoning</option>
                      <option value="english">English</option>
                      <option value="ga">General Awareness</option>
                    </select>
                    <input
                      type="number"
                      aria-label="Target Tests Count"
                      value={taskTargetTests}
                      onChange={(e) => setTaskTargetTests(e.target.value)}
                      min={1}
                      max={50}
                      className="w-20 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                      title="Target tests count"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      aria-label="Bonus XP"
                      value={taskBonusXp}
                      onChange={(e) => setTaskBonusXp(e.target.value)}
                      placeholder="Bonus XP"
                      className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                    />
                    <input
                      type="date"
                      aria-label="Due Date"
                      value={taskDueDate}
                      onChange={(e) => setTaskDueDate(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
                    >
                      Assign Task to Cohort
                    </button>
                  </div>
                </form>

                {tasks.length > 0 && (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800 pt-2">
                    {tasks.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {t.title} · +{t.bonusXp} XP
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {t.description} ({t.targetTests}x {t.targetSubject}, due {t.dueDate})
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await toggleCohortTask(t.id, !t.active);
                              } catch (err) {
                                notify('err', err instanceof Error ? err.message : 'Failed to toggle task status.');
                              }
                            }}
                            className={`font-semibold underline cursor-pointer ${
                              t.active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {t.active ? 'Active' : 'Paused'}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete task ${t.title}`}
                            onClick={async () => {
                              try {
                                await deleteCohortTask(t.id);
                              } catch (err) {
                                notify('err', err instanceof Error ? err.message : 'Failed to delete task.');
                              }
                            }}
                            className="text-slate-500 dark:text-slate-400 hover:text-red-700 dark:hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4. LIVE QUESTION BANK (STARTER PACK + MANUAL + AI + EXTERNAL API + BULK JSON/CSV) */}
        {activeTab === 'questions' && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  SSC CGL Bilingual Master Bank (120 Qs · 22 Mocks · 6 Targets)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ensures Quant, Reasoning, English &amp; GA starter questions, mocks, and bonus tasks exist in Firestore without duplicates.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setWipeQuestionsModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 whitespace-nowrap cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Wipe Old Database</span>
                </button>
                <button
                  type="button"
                  disabled={seedBusy}
                  onClick={handleSeedStarterPack}
                  className="rounded-lg bg-slate-900 dark:bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {seedBusy ? 'Syncing...' : 'Sync Starter Pack'}
                </button>
              </div>
            </div>
            <WipeQuestionsModal
              open={wipeQuestionsModalOpen}
              liveQuestionCount={questions.length}
              onClose={() => setWipeQuestionsModalOpen(false)}
              onWiped={(deleted) =>
                notify('ok', `Wiped ${deleted} old question(s) from Firestore questions collection.`)
              }
              onError={(msg) => notify('err', msg)}
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Single Question Manual Creator */}
              <form
                onSubmit={handleSaveManualQuestion}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      Add Single Question (Direct Entry)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Type one English or bilingual MCQ directly into Firestore
                    </p>
                  </div>
                  <Plus className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <select
                    aria-label="Question Subject"
                    value={mqSubject}
                    onChange={(e) => setMqSubject(e.target.value as SubjectKey)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value="quant">Quant</option>
                    <option value="reasoning">Reasoning</option>
                    <option value="english">English</option>
                    <option value="ga">GA / GK</option>
                  </select>
                  <input
                    type="text"
                    aria-label="Question Topic"
                    value={mqTopic}
                    onChange={(e) => setMqTopic(e.target.value)}
                    placeholder="Topic"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                  <select
                    aria-label="Question Difficulty"
                    value={mqDifficulty}
                    onChange={(e) => setMqDifficulty(e.target.value as DifficultyLevel)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                  <input
                    type="text"
                    aria-label="Year Tag"
                    value={mqYearTag}
                    onChange={(e) => setMqYearTag(e.target.value)}
                    placeholder="PYQ Tag"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <textarea
                  rows={2}
                  value={mqQuestionEn}
                  onChange={(e) => setMqQuestionEn(e.target.value)}
                  placeholder="Question in English (required)"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-2.5 text-xs text-slate-900 dark:text-slate-100"
                />
                <textarea
                  rows={2}
                  value={mqQuestionHi}
                  onChange={(e) => setMqQuestionHi(e.target.value)}
                  placeholder="प्रश्न हिन्दी में (optional)"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-2.5 text-xs text-slate-900 dark:text-slate-100"
                />

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(['A', 'B', 'C', 'D'] as const).map((letter, idx) => (
                    <div key={letter} className="space-y-1">
                      <input
                        type="text"
                        value={mqOptsEn[idx]}
                        onChange={(e) => {
                          const next = [...mqOptsEn] as [string, string, string, string];
                          next[idx] = e.target.value;
                          setMqOptsEn(next);
                        }}
                        placeholder={`Option ${letter} (English)`}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={mqOptsHi[idx]}
                        onChange={(e) => {
                          const next = [...mqOptsHi] as [string, string, string, string];
                          next[idx] = e.target.value;
                          setMqOptsHi(next);
                        }}
                        placeholder={`विकल्प ${letter} (हिन्दी optional)`}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <select
                    aria-label="Correct Answer Option"
                    value={mqCorrectIdx}
                    onChange={(e) => setMqCorrectIdx(Number(e.target.value) as 0 | 1 | 2 | 3)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value={0}>Correct: Option A</option>
                    <option value={1}>Correct: Option B</option>
                    <option value={2}>Correct: Option C</option>
                    <option value={3}>Correct: Option D</option>
                  </select>
                  <input
                    type="text"
                    value={mqExplEn}
                    onChange={(e) => setMqExplEn(e.target.value)}
                    placeholder="Short solution / explanation (optional)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 sm:col-span-2"
                  />
                </div>
                <input
                  type="text"
                  value={mqShortTrick}
                  onChange={(e) => setMqShortTrick(e.target.value)}
                  placeholder="Short trick / shortcut formula (optional)"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                />

                <button
                  type="submit"
                  disabled={mqBusy}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                >
                  {mqBusy ? 'Saving...' : 'Save Question to Bank'}
                </button>
              </form>

              {/* AI SSC CGL Bilingual Question Generator */}
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      Generate SSC CGL Questions (Bilingual)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Create fresh English + Hindi MCQs with solutions for any topic
                    </p>
                  </div>
                  <Languages className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <select
                    aria-label="AI Subject"
                    value={aiSubject}
                    onChange={(e) => setAiSubject(e.target.value as SubjectKey)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value="quant">Quantitative Aptitude</option>
                    <option value="reasoning">Reasoning</option>
                    <option value="english">English Comprehension</option>
                    <option value="ga">General Awareness</option>
                  </select>
                  <input
                    type="text"
                    aria-label="AI Topic"
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    placeholder="Topic (e.g. Trigonometry, Polity)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                  <select
                    aria-label="AI Difficulty"
                    value={aiDifficulty}
                    onChange={(e) => setAiDifficulty(e.target.value as DifficultyLevel)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="easy">Easy (Tier-I)</option>
                    <option value="medium">Medium (Tier-I/II)</option>
                    <option value="hard">Hard (Tier-II)</option>
                  </select>
                  <input
                    type="number"
                    aria-label="Question Count"
                    min={1}
                    max={10}
                    value={aiCount}
                    onChange={(e) => setAiCount(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={aiBusy}
                    onClick={handleGenerateAiQuestions}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                  >
                    {aiBusy ? 'Generating...' : 'Generate Bilingual Questions'}
                  </button>
                  {aiPreview.length > 0 && (
                    <button
                      type="button"
                      disabled={aiBusy}
                      onClick={handleCommitAiQuestions}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Save {aiPreview.length} to Firestore</span>
                    </button>
                  )}
                </div>

                {aiPreview.length > 0 && (
                  <div className="max-h-[34rem] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-[#131720] p-3 space-y-3 text-xs">
                    {aiPreview.map((q, i) => {
                      const updateDraft = (patch: Partial<QuestionInput>) =>
                        setAiPreview((prev) =>
                          prev.map((item, idx) => (idx === i ? { ...item, ...patch } : item))
                        );
                      return (
                        <div
                          key={i}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-3 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                              Draft #{i + 1} · Edit Before Saving
                            </span>
                            <button
                              type="button"
                              onClick={() => setAiPreview((prev) => prev.filter((_, idx) => idx !== i))}
                              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden="true" />
                              <span>Remove</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <input
                              type="text"
                              aria-label={`Draft ${i + 1} Topic`}
                              value={q.topic}
                              onChange={(e) => updateDraft({ topic: e.target.value })}
                              placeholder="Topic"
                              className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                            />
                            <select
                              aria-label={`Draft ${i + 1} Difficulty`}
                              value={q.difficulty}
                              onChange={(e) =>
                                updateDraft({ difficulty: e.target.value as DifficultyLevel })
                              }
                              className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                            >
                              <option value="easy">Easy</option>
                              <option value="medium">Medium</option>
                              <option value="hard">Hard</option>
                            </select>
                            <select
                              aria-label={`Draft ${i + 1} Correct Option`}
                              value={q.correctIndex}
                              onChange={(e) =>
                                updateDraft({ correctIndex: Number(e.target.value) as 0 | 1 | 2 | 3 })
                              }
                              className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
                            >
                              <option value={0}>Answer: Option A</option>
                              <option value={1}>Answer: Option B</option>
                              <option value={2}>Answer: Option C</option>
                              <option value={3}>Answer: Option D</option>
                            </select>
                          </div>

                          <textarea
                            rows={2}
                            aria-label={`Draft ${i + 1} Question English`}
                            value={q.questionEn}
                            onChange={(e) => updateDraft({ questionEn: e.target.value })}
                            placeholder="Question (English)"
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-2 text-xs text-slate-900 dark:text-slate-100"
                          />
                          <textarea
                            rows={2}
                            aria-label={`Draft ${i + 1} Question Hindi`}
                            value={q.questionHi ?? ''}
                            onChange={(e) => updateDraft({ questionHi: e.target.value })}
                            placeholder="प्रश्न (हिन्दी)"
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-2 text-xs text-slate-900 dark:text-slate-100"
                          />

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {(['A', 'B', 'C', 'D'] as const).map((ltr, optIdx) => (
                              <div key={ltr} className="space-y-1">
                                <input
                                  type="text"
                                  aria-label={`Draft ${i + 1} Option ${ltr} English`}
                                  value={q.optionsEn[optIdx] ?? ''}
                                  onChange={(e) => {
                                    const next = [...q.optionsEn] as [string, string, string, string];
                                    next[optIdx] = e.target.value;
                                    updateDraft({ optionsEn: next });
                                  }}
                                  placeholder={`Option ${ltr} (EN)`}
                                  className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                                />
                                <input
                                  type="text"
                                  aria-label={`Draft ${i + 1} Option ${ltr} Hindi`}
                                  value={q.optionsHi?.[optIdx] ?? ''}
                                  onChange={(e) => {
                                    const base = q.optionsHi ?? ['', '', '', ''];
                                    const next = [...base] as [string, string, string, string];
                                    next[optIdx] = e.target.value;
                                    updateDraft({ optionsHi: next });
                                  }}
                                  placeholder={`विकल्प ${ltr} (HI)`}
                                  className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                                />
                              </div>
                            ))}
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input
                              type="text"
                              aria-label={`Draft ${i + 1} Explanation English`}
                              value={q.explanationEn ?? ''}
                              onChange={(e) => updateDraft({ explanationEn: e.target.value })}
                              placeholder="Explanation (English)"
                              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                            />
                            <input
                              type="text"
                              aria-label={`Draft ${i + 1} Short Trick`}
                              value={q.shortTrick ?? ''}
                              onChange={(e) => updateDraft({ shortTrick: e.target.value })}
                              placeholder="Short trick / formula"
                              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* External Question API Fetcher */}
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      Third-Party External Question API
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Fetch live GK/Current Affairs/Aptitude questions directly in browser (CORS)
                    </p>
                  </div>
                  <Globe className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <select
                    aria-label="External API Provider"
                    value={extProvider}
                    onChange={(e) => setExtProvider(e.target.value as 'opentdb' | 'custom_url')}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value="opentdb">Open Trivia DB (Live Public API)</option>
                    <option value="custom_url">Custom External Quiz/SSC API URL</option>
                  </select>

                  <select
                    aria-label="Target SSC Section"
                    value={extSubject}
                    onChange={(e) => setExtSubject(e.target.value as SubjectKey)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value="ga">Map to General Awareness</option>
                    <option value="quant">Map to Quantitative Aptitude</option>
                    <option value="reasoning">Map to Reasoning</option>
                    <option value="english">Map to English Comprehension</option>
                  </select>
                </div>

                {extProvider === 'opentdb' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      aria-label="OpenTDB Category"
                      value={extCategory}
                      onChange={(e) => setExtCategory(e.target.value)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="9">General Knowledge</option>
                      <option value="23">History</option>
                      <option value="22">Geography</option>
                      <option value="17">Science &amp; Nature</option>
                      <option value="19">Mathematics</option>
                      <option value="18">Computers / Tech</option>
                      <option value="24">Politics</option>
                    </select>
                    <input
                      type="number"
                      aria-label="Fetch Count"
                      min={1}
                      max={25}
                      value={extAmount}
                      onChange={(e) => setExtAmount(e.target.value)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="url"
                      value={extCustomUrl}
                      onChange={(e) => setExtCustomUrl(e.target.value)}
                      placeholder="https://api.example.com/v1/ssc-questions"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={extHeaderName}
                        onChange={(e) => setExtHeaderName(e.target.value)}
                        placeholder="Header (Authorization or x-api-key)"
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                      />
                      <input
                        type="password"
                        value={extCustomKey}
                        onChange={(e) => setExtCustomKey(e.target.value)}
                        placeholder="Optional API Key (sent via HTTPS header)"
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={extBusy}
                    onClick={handleFetchExternalQuestions}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                  >
                    {extBusy ? 'Fetching...' : 'Fetch Live Questions'}
                  </button>

                  {extPreview.length > 0 && (
                    <>
                      <button
                        type="button"
                        disabled={extBusy}
                        onClick={handleTranslateExtPreview}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Languages className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                        <span>Add Hindi Translations</span>
                      </button>
                      <button
                        type="button"
                        disabled={extBusy}
                        onClick={handleCommitExtPreview}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Save {extPreview.length} to Firestore</span>
                      </button>
                    </>
                  )}
                </div>

                {extPreview.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-3 space-y-2 text-xs">
                    {extPreview.map((q, i) => (
                      <div key={i} className="border-b border-slate-200 dark:border-slate-800 pb-2 last:border-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {i + 1}. {q.questionEn}
                        </div>
                        {q.questionHi && <div className="text-blue-800 dark:text-blue-300">{q.questionHi}</div>}
                        <div className="text-slate-500 dark:text-slate-400">
                          Ans: {q.optionsEn[q.correctIndex]} · {q.topic}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Bulk JSON / CSV PYQ Uploader */}
              <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      Custom PYQ Bank (Bulk JSON / CSV)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Upload or paste bilingual SSC CGL previous-year questions
                    </p>
                  </div>
                  <FileSpreadsheet className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-[#11151d] p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setBulkMode('json');
                        setBulkPreview(null);
                      }}
                      className={`rounded-md px-3 py-1 text-xs font-semibold cursor-pointer ${
                        bulkMode === 'json'
                          ? 'bg-[#faf9f6] dark:bg-[#1e2431] text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      JSON Array
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkMode('csv');
                        setBulkPreview(null);
                      }}
                      className={`rounded-md px-3 py-1 text-xs font-semibold cursor-pointer ${
                        bulkMode === 'csv'
                          ? 'bg-[#faf9f6] dark:bg-[#1e2431] text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      CSV Sheet
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setBulkText(bulkMode === 'json' ? JSON_FORMAT_EXAMPLE : CSV_FORMAT_EXAMPLE)
                      }
                      className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Insert Schema Format
                    </button>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 underline cursor-pointer">
                      Load File
                      <input
                        type="file"
                        accept=".json,.csv,.txt"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          f.text().then((txt) => setBulkText(txt));
                        }}
                      />
                    </label>
                  </div>
                </div>

                <textarea
                  rows={6}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={
                    bulkMode === 'json'
                      ? 'Paste JSON array of SSC CGL questions...'
                      : 'Paste CSV with header row: subject,topic,difficulty,questionEn,optionA,optionB,optionC,optionD,answer...'
                  }
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-3 font-mono text-xs text-slate-900 dark:text-slate-100"
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleValidateBulk}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Validate Schema
                  </button>
                  {bulkPreview && bulkPreview.valid.length > 0 && (
                    <button
                      type="button"
                      onClick={handleCommitBulk}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                    >
                      Upload {bulkPreview.valid.length} Valid Questions
                    </button>
                  )}
                </div>

                {bulkPreview && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-3 text-xs space-y-1">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Validation Result: {bulkPreview.valid.length} valid · {bulkPreview.errors.length} errors
                    </div>
                    {bulkPreview.errors.slice(0, 4).map((e, idx) => (
                      <div key={idx} className="text-red-700 dark:text-red-400">
                        {e.message}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Live Question Bank List */}
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                    Firestore Question Bank ({filteredQuestions.length})
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Filter Question Bank by Subject"
                    value={qFilterSubject}
                    onChange={(e) => setQFilterSubject(e.target.value as 'all' | SubjectKey)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value="all">All Subjects</option>
                    <option value="quant">Quant</option>
                    <option value="reasoning">Reasoning</option>
                    <option value="english">English</option>
                    <option value="ga">General Awareness</option>
                  </select>
                  <input
                    type="search"
                    value={qSearch}
                    onChange={(e) => setQSearch(e.target.value)}
                    placeholder="Search topic or stem..."
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {filteredQuestions.length === 0 ? (
                <div className="py-6 text-center space-y-2.5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {questions.length === 0
                      ? 'No questions in Firestore yet. Import from an External Question API or upload JSON/CSV PYQs above.'
                      : 'No questions match your current subject or search filter.'}
                  </p>
                  {questions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setQFilterSubject('all');
                        setQSearch('');
                      }}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Reset Filter &amp; Show All ({questions.length})
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                        <th className="py-2 pr-3">Section · Topic</th>
                        <th className="py-2 pr-3">Question (EN / HI)</th>
                        <th className="py-2 pr-3">Source</th>
                        <th className="py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {filteredQuestions.slice(0, 50).map((q) => (
                        <tr key={q.id}>
                          <td className="py-3 pr-3 whitespace-nowrap">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {SUBJECT_LABELS[q.subject].short}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {q.topic} · {q.difficulty}
                            </div>
                          </td>
                          <td className="py-3 pr-3 max-w-lg">
                            <div className="font-medium text-slate-900 dark:text-slate-100 line-clamp-2">
                              {q.questionEn}
                            </div>
                            {q.questionHi && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-1">
                                {q.questionHi}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{q.source}</td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              aria-label={`Delete question ${q.id}`}
                              onClick={async () => {
                                try {
                                  await deleteQuestion(q.id);
                                } catch (err) {
                                  notify('err', err instanceof Error ? err.message : 'Failed to delete question.');
                                }
                              }}
                              className="text-slate-500 dark:text-slate-400 hover:text-red-700 dark:hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4 inline" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* 5. MOCK TEST COMPOSER */}
        {activeTab === 'tests' && (
          <div className="space-y-6">
            <section className="flex flex-col gap-4 rounded-xl border border-blue-200 dark:border-blue-800/70 bg-blue-50/50 dark:bg-blue-950/25 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Zero-Effort Daily Mock &amp; Sectional Automation
                </h2>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                  Auto-generates today&apos;s Daily Live Full Mock AND all 4 subject Daily Sectional Sprints (Quant, Reasoning, English, GA). Pre-generate the full 7-day schedule in one click.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <span className="rounded border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {(() => {
                    const tk = getLocalDateKey();
                    const fullOk = tests.some((t) => t.id === `${DAILY_MOCK_PREFIX}${tk}`);
                    const secCount = (['quant', 'reasoning', 'english', 'ga'] as const).filter((s) =>
                      tests.some((t) => t.id === buildDailySectionalTestId(s, tk))
                    ).length;
                    return `Today: Full ${fullOk ? '✓' : 'Pending'} · Sectionals ${secCount}/4`;
                  })()}
                </span>
                <button
                  type="button"
                  disabled={weeklyAutoBusy}
                  onClick={async () => {
                    setWeeklyAutoBusy(true);
                    let mocksCreated = 0;
                    let sectionalsCreated = 0;
                    try {
                      const base = new Date();
                      for (let offset = 0; offset < 7; offset += 1) {
                        const target = new Date(base);
                        target.setDate(base.getDate() + offset);
                        const res = await ensureDailyAutomationSuite({
                          scoringConfig,
                          forceDateKey: getLocalDateKey(target),
                        });
                        if (res.dailyMockCreated) mocksCreated += 1;
                        sectionalsCreated += res.sectionalsCreated;
                      }
                      notify(
                        'ok',
                        mocksCreated > 0 || sectionalsCreated > 0
                          ? `Auto-generated +${mocksCreated} Daily Full Mock(s) and +${sectionalsCreated} Daily Sectional Test(s) for the upcoming week!`
                          : 'All 7 upcoming Daily Full Mocks & 28 Sectional Sprints are already active and published.'
                      );
                    } catch (err) {
                      notify('err', err instanceof Error ? err.message : 'Auto-generation failed.');
                    } finally {
                      setWeeklyAutoBusy(false);
                    }
                  }}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                >
                  {weeklyAutoBusy ? 'Generating 7-Day Suite...' : 'Auto-Create 7 Days (Mocks + Sectionals)'}
                </button>
              </div>
            </section>

            {/* BLUEPRINT CUSTOM MOCK JSON BUILDER */}
            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Layers className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      Chapter-Blueprint Custom Mock Builder (JSON + Instant Publish)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Pick exact chapter/topic quotas to assemble a balanced paper, download as a portable JSON file for offline distribution, or publish live immediately.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={bpImportInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setBpBusy(true);
                      try {
                        const text = await file.text();
                        const parsed = parsePortableCustomMockJson(text);
                        const qInputs: QuestionInput[] = parsed.paper.questions.map((q) => ({
                          subject: q.subject,
                          topic: q.topic,
                          difficulty: q.difficulty,
                          yearTag: q.yearTag,
                          source: q.source || 'Custom Mock JSON',
                          questionEn: q.questionEn,
                          ...(q.questionHi ? { questionHi: q.questionHi } : {}),
                          optionsEn: q.optionsEn,
                          ...(q.optionsHi ? { optionsHi: q.optionsHi } : {}),
                          correctIndex: q.correctIndex,
                          ...(q.explanationEn ? { explanationEn: q.explanationEn } : {}),
                          ...(q.explanationHi ? { explanationHi: q.explanationHi } : {}),
                          ...(q.shortTrick ? { shortTrick: q.shortTrick } : {}),
                        }));
                        const { ids: savedIds } = await addQuestionsBatchWithIds(qInputs, adminUid);
                        await createCustomMockFromBlueprintPaper({
                          uid: adminUid,
                          title: parsed.paper.title,
                          subjectScope: parsed.paper.subjectScope,
                          durationMinutes: parsed.paper.durationMinutes,
                          positiveMarks: parsed.paper.positiveMarks,
                          negativeMarks: parsed.paper.negativeMarks,
                          questionIds: savedIds,
                          published: parsed.paper.published,
                        });
                        notify('ok', `Imported "${parsed.paper.title}" (${savedIds.length} Qs) and published to students.`);
                      } catch (err) {
                        notify('err', err instanceof Error ? err.message : 'Failed to import custom mock JSON.');
                      } finally {
                        setBpBusy(false);
                      }
                    }}
                    className="hidden"
                    aria-label="Import Custom Mock Paper JSON"
                  />
                  <button
                    type="button"
                    disabled={bpBusy}
                    onClick={() => bpImportInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Import Mock JSON</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label htmlFor="bp-title" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Blueprint Mock Title
                  </label>
                  <input
                    id="bp-title"
                    type="text"
                    value={bpTitle}
                    onChange={(e) => setBpTitle(e.target.value)}
                    placeholder="e.g., Arithmetic + Polity Target Drill"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="bp-dur" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Duration (min)
                  </label>
                  <input
                    id="bp-dur"
                    type="number"
                    min={1}
                    max={240}
                    value={bpDuration}
                    onChange={(e) => setBpDuration(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="bp-pos" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      +Marks
                    </label>
                    <input
                      id="bp-pos"
                      type="number"
                      step="0.5"
                      value={bpPosMarks}
                      onChange={(e) => setBpPosMarks(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="bp-neg" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      -Marks
                    </label>
                    <input
                      id="bp-neg"
                      type="number"
                      step="0.25"
                      value={bpNegMarks}
                      onChange={(e) => setBpNegMarks(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              {/* Add Chapter Quota Row */}
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-3">
                <div>
                  <label htmlFor="bp-sub" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Section
                  </label>
                  <select
                    id="bp-sub"
                    value={bpSlotSubject}
                    onChange={(e) => {
                      const nextSub = e.target.value as SubjectKey;
                      setBpSlotSubject(nextSub);
                      const firstChap = MICRO_SYLLABUS_CHAPTERS.find((c) => c.subject === nextSub);
                      if (firstChap) setBpSlotTopic(firstChap.slug);
                    }}
                    className="mt-1 rounded-md border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="quant">Quant</option>
                    <option value="reasoning">Reasoning</option>
                    <option value="english">English</option>
                    <option value="ga">GA</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label htmlFor="bp-topic" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Chapter / Topic
                  </label>
                  <select
                    id="bp-topic"
                    value={bpSlotTopic}
                    onChange={(e) => setBpSlotTopic(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    {MICRO_SYLLABUS_CHAPTERS.filter((c) => c.subject === bpSlotSubject).map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-20">
                  <label htmlFor="bp-cnt" className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Qs
                  </label>
                  <input
                    id="bp-cnt"
                    type="number"
                    min={1}
                    max={50}
                    value={bpSlotCount}
                    onChange={(e) => setBpSlotCount(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const cnt = Math.max(1, Math.min(50, Number(bpSlotCount) || 5));
                    setBpSlots((prev) => [
                      ...prev,
                      { subject: bpSlotSubject, chapterSlugOrTopic: bpSlotTopic, count: cnt },
                    ]);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-900 dark:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Topic Slot</span>
                </button>
              </div>

              {bpSlots.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {bpSlots.map((slot, idx) => {
                    const chap = MICRO_SYLLABUS_CHAPTERS.find((c) => c.slug === slot.chapterSlugOrTopic);
                    return (
                      <span
                        key={`${slot.chapterSlugOrTopic}_${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#131720] px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200"
                      >
                        <span>
                          {SUBJECT_LABELS[slot.subject].short}: {chap?.title || slot.chapterSlugOrTopic} ({slot.count} Qs)
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove slot ${chap?.title || slot.chapterSlugOrTopic}`}
                          onClick={() => setBpSlots((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-slate-500 hover:text-red-600 cursor-pointer"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-3">
                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                  <div>
                    Assembled Preview:{' '}
                    <strong className="font-mono text-slate-900 dark:text-white">
                      {bpAssembled.questionIds.length} questions matched
                    </strong>{' '}
                    ({bpAssembled.subjectScope === 'full' ? 'Multi-Section Full' : SUBJECT_LABELS[bpAssembled.subjectScope].short})
                  </div>
                  {bpAssembled.shortfalls.length > 0 && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-400">
                      Bank shortfall:{' '}
                      {bpAssembled.shortfalls
                        .map((sf) => `${sf.label} (${sf.matched}/${sf.requested})`)
                        .join(', ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={bpAssembled.questionIds.length === 0}
                    onClick={() => {
                      const payload = buildPortableCustomMockJson({
                        title: bpTitle || 'Chapter Blueprint Mock',
                        durationMinutes: Number(bpDuration) || 30,
                        positiveMarks: Number(bpPosMarks) || scoringConfig.pointsPerCorrect,
                        negativeMarks: Number(bpNegMarks) || scoringConfig.negativeMarks,
                        published: true,
                        assembled: bpAssembled,
                      });
                      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `custom-mock-${(bpTitle || 'paper').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      notify('ok', `Downloaded "${payload.paper.title}" (${payload.paper.questions.length} Qs) as Mock JSON.`);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Download Mock JSON</span>
                  </button>
                  <button
                    type="button"
                    disabled={bpBusy || !bpTitle.trim() || bpAssembled.questionIds.length === 0}
                    onClick={async () => {
                      setBpBusy(true);
                      try {
                        const created = await createCustomMockFromBlueprintPaper({
                          uid: adminUid,
                          title: bpTitle.trim(),
                          subjectScope: bpAssembled.subjectScope,
                          durationMinutes: Number(bpDuration) || 30,
                          positiveMarks: Number(bpPosMarks) || scoringConfig.pointsPerCorrect,
                          negativeMarks: Number(bpNegMarks) || scoringConfig.negativeMarks,
                          questionIds: bpAssembled.questionIds,
                          published: true,
                        });
                        notify('ok', `Published blueprint mock "${created.title}" (${created.questionCount} Qs) live to students.`);
                      } catch (err) {
                        notify('err', err instanceof Error ? err.message : 'Failed to publish blueprint mock.');
                      } finally {
                        setBpBusy(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{bpBusy ? 'Publishing...' : 'Publish Blueprint Mock'}</span>
                  </button>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <form
              onSubmit={handleCreateTest}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4 lg:col-span-7"
            >
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Compose &amp; Publish Mock Test
              </h2>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="test-title" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Test Title
                  </label>
                  <input
                    id="test-title"
                    type="text"
                    value={testTitle}
                    onChange={(e) => setTestTitle(e.target.value)}
                    placeholder="e.g., SSC CGL Tier-I Live Mock #01"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="test-scope" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Test Scope
                  </label>
                  <select
                    id="test-scope"
                    value={testScope}
                    onChange={(e) => setTestScope(e.target.value as 'full' | SubjectKey)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                  >
                    <option value="full">Full SSC CGL Tier-I</option>
                    <option value="quant">Quantitative Aptitude Sectional</option>
                    <option value="reasoning">Reasoning Sectional</option>
                    <option value="english">English Sectional</option>
                    <option value="ga">General Awareness Quiz</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="test-dur" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Duration (Minutes)
                  </label>
                  <input
                    id="test-dur"
                    type="number"
                    min={1}
                    max={240}
                    value={testDuration}
                    onChange={(e) => setTestDuration(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="test-pos" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Marks / Correct
                  </label>
                  <input
                    id="test-pos"
                    type="number"
                    step="0.5"
                    value={testPosMarks}
                    onChange={(e) => setTestPosMarks(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="test-neg" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Negative Marking / Wrong
                  </label>
                  <input
                    id="test-neg"
                    type="number"
                    step="0.25"
                    value={testNegMarks}
                    onChange={(e) => setTestNegMarks(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Select Questions ({selectedQIds.length} / 100 selected)
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Filter composer questions"
                      value={composerSubjectFilter}
                      onChange={(e) =>
                        setComposerSubjectFilter(e.target.value as 'all' | SubjectKey)
                      }
                      className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="all">All Sections</option>
                      <option value="quant">Quant</option>
                      <option value="reasoning">Reasoning</option>
                      <option value="english">English</option>
                      <option value="ga">GA</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const pool = questions
                          .filter(
                            (q) => composerSubjectFilter === 'all' || q.subject === composerSubjectFilter
                          )
                          .slice(0, 100)
                          .map((q) => q.id);
                        setSelectedQIds(pool);
                      }}
                      className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Select Filtered
                    </button>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80">
                  {questions.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500 dark:text-slate-400">
                      Your Question Bank is empty. Import live questions in the Question Bank tab first.
                    </p>
                  ) : (
                    questions
                      .filter(
                        (q) => composerSubjectFilter === 'all' || q.subject === composerSubjectFilter
                      )
                      .map((q) => {
                        const checked = selectedQIds.includes(q.id);
                        return (
                          <label
                            key={q.id}
                            className="flex items-start gap-3 p-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedQIds((prev) =>
                                  checked
                                    ? prev.filter((id) => id !== q.id)
                                    : prev.length < 100
                                      ? [...prev, q.id]
                                      : prev
                                );
                              }}
                              className="mt-0.5 accent-blue-700"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-slate-900 dark:text-slate-100 line-clamp-1">
                                {q.questionEn}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {SUBJECT_LABELS[q.subject].short} · {q.topic} · {q.difficulty}
                              </div>
                            </div>
                          </label>
                        );
                      })
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={selectedQIds.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Publish Mock Test</span>
              </button>
            </form>

            <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4 lg:col-span-5">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Cohort Mock Tests ({cohortTests.length})
              </h2>

              {cohortTests.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">No mock tests published yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-[520px] overflow-y-auto pr-1">
                  {cohortTests.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{t.title}</div>
                        <div className="text-slate-500 dark:text-slate-400">
                          {t.questionCount} Qs · {t.durationMinutes}m · +{t.positiveMarks}/-{t.negativeMarks}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await toggleMockTestPublish(t.id, !t.published);
                            } catch (err) {
                              notify('err', err instanceof Error ? err.message : 'Failed to toggle publish state.');
                            }
                          }}
                          className={`font-semibold underline cursor-pointer ${
                            t.published ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {t.published ? 'Published' : 'Draft'}
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete test ${t.title}`}
                          onClick={async () => {
                            try {
                              await deleteMockTest(t.id);
                            } catch (err) {
                              notify('err', err instanceof Error ? err.message : 'Failed to delete mock test.');
                            }
                          }}
                          className="text-slate-500 dark:text-slate-400 hover:text-red-700 dark:hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            </div>
          </div>
        )}

        {/* 5B. AI PDF-TO-FIRESTORE INGESTOR */}
        {activeTab === 'pdf-ingestor' && (
          <AdminPdfIngestor
            adminUid={adminUid}
            liveQuestionCount={questions.length}
            onNotify={notify}
          />
        )}

        {/* 5C. PDF AUTO-EXTRACTOR & SAVER */}
        {activeTab === 'pdf-auto-extractor' && (
          <PdfQuestionExtractor adminUid={adminUid} onNotify={notify} />
        )}

        {/* 5D. REPORTED QUESTIONS & ADMIN ANSWER OVERRIDE */}
        {activeTab === 'reports' && (
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <Flag className="h-5 w-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                    Reported Queries &amp; Global Answer/Solution Overrides
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Review student-flagged errors across live reviews and Vault cards. Saving an override immediately updates <code className="font-mono">corrected_questions_bank</code> and the live Question Bank for all aspirants.
                  </p>
                </div>
              </div>
              <span className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#131720] px-3 py-1 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                {openReportsCount} open · {reportedQueries.length - openReportsCount} resolved
              </span>
            </div>

            {sortedReports.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No question or AI solution error reports submitted by students yet.
              </p>
            ) : (
              <div className="space-y-4">
                {sortedReports.map((rep) => {
                  const isOpen = rep.status === 'open';
                  const draft = getReportDraft(rep);
                  return (
                    <article
                      key={rep.id}
                      className={`rounded-xl border p-5 space-y-4 ${
                        isOpen
                          ? 'border-rose-300 dark:border-rose-800/70 bg-rose-50/35 dark:bg-rose-950/15'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#131720]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                              QID: {rep.questionId}
                            </span>
                            <span className="rounded bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                              {rep.sourceContext}
                            </span>
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                                isOpen
                                  ? 'bg-rose-200 dark:bg-rose-900/60 text-rose-950 dark:text-rose-200'
                                  : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                              }`}
                            >
                              {isOpen ? 'Open Report' : 'Resolved & Overridden'}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-rose-800 dark:text-rose-300">
                            Issue: {rep.reason}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            Reported by {rep.studentName} (@{rep.loginId}) · {formatDateTimeShort(rep.createdAtMs)}
                          </p>
                        </div>
                      </div>

                      {rep.aiExplanationSnapshot && (
                        <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/25 p-3 text-xs text-slate-700 dark:text-slate-300">
                          <div className="font-bold text-blue-900 dark:text-blue-300 mb-1">
                            Snapshot of AI Explanation Reported:
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed">{rep.aiExplanationSnapshot}</p>
                        </div>
                      )}

                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-4 space-y-3 text-xs">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Subject
                            </label>
                            <select
                              value={draft.subject}
                              onChange={(e) =>
                                patchReportDraft(rep, { subject: e.target.value as SubjectKey })
                              }
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                            >
                              <option value="quant">Quant</option>
                              <option value="reasoning">Reasoning</option>
                              <option value="english">English</option>
                              <option value="ga">GA / GK</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Topic
                            </label>
                            <input
                              type="text"
                              value={draft.topic}
                              onChange={(e) => patchReportDraft(rep, { topic: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Difficulty
                            </label>
                            <select
                              value={draft.difficulty}
                              onChange={(e) =>
                                patchReportDraft(rep, { difficulty: e.target.value as DifficultyLevel })
                              }
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                            >
                              <option value="easy">Easy</option>
                              <option value="medium">Medium</option>
                              <option value="hard">Hard</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Verified Correct Option
                            </label>
                            <select
                              value={draft.correctIndex}
                              onChange={(e) =>
                                patchReportDraft(rep, {
                                  correctIndex: Number(e.target.value) as 0 | 1 | 2 | 3,
                                })
                              }
                              className="w-full rounded-lg border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 font-semibold text-xs text-emerald-800 dark:text-emerald-300"
                            >
                              <option value={0}>Option A</option>
                              <option value={1}>Option B</option>
                              <option value={2}>Option C</option>
                              <option value={3}>Option D</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Question Stem (English)
                            </label>
                            <textarea
                              rows={2}
                              value={draft.questionEn}
                              onChange={(e) => patchReportDraft(rep, { questionEn: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-2 text-xs text-slate-900 dark:text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Question Stem (Hindi - Optional)
                            </label>
                            <textarea
                              rows={2}
                              value={draft.questionHi}
                              onChange={(e) => patchReportDraft(rep, { questionHi: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-2 text-xs text-slate-900 dark:text-slate-100"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {(['A', 'B', 'C', 'D'] as const).map((ltr, optIdx) => (
                            <div key={ltr} className="grid grid-cols-2 gap-1.5">
                              <input
                                type="text"
                                aria-label={`Report ${rep.id} Option ${ltr} EN`}
                                value={draft.optionsEn[optIdx]}
                                onChange={(e) => {
                                  const next = [...draft.optionsEn] as [string, string, string, string];
                                  next[optIdx] = e.target.value;
                                  patchReportDraft(rep, { optionsEn: next });
                                }}
                                placeholder={`Option ${ltr} (EN)`}
                                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                              />
                              <input
                                type="text"
                                aria-label={`Report ${rep.id} Option ${ltr} HI`}
                                value={draft.optionsHi[optIdx]}
                                onChange={(e) => {
                                  const next = [...draft.optionsHi] as [string, string, string, string];
                                  next[optIdx] = e.target.value;
                                  patchReportDraft(rep, { optionsHi: next });
                                }}
                                placeholder={`विकल्प ${ltr} (HI)`}
                                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                              />
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Corrected Explanation (English)
                            </label>
                            <textarea
                              rows={2}
                              value={draft.explanationEn}
                              onChange={(e) => patchReportDraft(rep, { explanationEn: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-2 text-xs text-slate-900 dark:text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                              Corrected Explanation (Hindi - Optional)
                            </label>
                            <textarea
                              rows={2}
                              value={draft.explanationHi}
                              onChange={(e) => patchReportDraft(rep, { explanationHi: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-2 text-xs text-slate-900 dark:text-slate-100"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <input
                            type="text"
                            value={draft.shortTrick}
                            onChange={(e) => patchReportDraft(rep, { shortTrick: e.target.value })}
                            placeholder="Verified Short Trick (optional)"
                            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                          />
                          <input
                            type="text"
                            value={draft.adminNotes}
                            onChange={(e) => patchReportDraft(rep, { adminNotes: e.target.value })}
                            placeholder="Admin resolution notes (optional)"
                            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          {rep.resolvedAtMs ? (
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                              Last updated {formatDateTimeShort(rep.resolvedAtMs)}
                            </span>
                          ) : (
                            <span />
                          )}
                          <button
                            type="button"
                            disabled={resolvingReportId === rep.id}
                            onClick={() => void handleSaveReportOverride(rep)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                          >
                            <Save className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {resolvingReportId === rep.id
                                ? 'Saving Override...'
                                : 'Save Override & Update Question Bank'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* 6. SUPPORT TICKETS & BUG REPORTS */}
        {activeTab === 'tickets' && (
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <Headset className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                    Student Support Tickets &amp; Bug Reports
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Issues reported in the student Admin Support tab appear here. Clicking &ldquo;Mark as Resolved&rdquo; sends an instant push notification to that student.
                  </p>
                </div>
              </div>
              <span className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#131720] px-3 py-1 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                {openTicketsCount} open · {supportTickets.length - openTicketsCount} resolved
              </span>
            </div>

            {sortedTickets.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No support tickets or bug reports submitted yet.
              </p>
            ) : (
              <div className="space-y-3">
                {sortedTickets.map((t) => {
                  const isOpen = t.status === 'open';
                  return (
                    <article
                      key={t.id}
                      className={`rounded-xl border p-4 space-y-3 ${
                        isOpen
                          ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/40 dark:bg-amber-950/15'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                              {t.subject}
                            </h3>
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                                isOpen
                                  ? 'bg-amber-200 dark:bg-amber-900/60 text-amber-950 dark:text-amber-200'
                                  : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                              }`}
                            >
                              {isOpen ? 'Unresolved' : 'Resolved'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            From: {t.studentName} (@{t.loginId}) · {formatDateTimeShort(t.createdAtMs)}
                          </p>
                        </div>
                      </div>

                      <p className="rounded-lg border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-3 text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                        {t.message}
                      </p>

                      {isOpen ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            type="text"
                            value={ticketReplies[t.id] ?? ''}
                            onChange={(e) =>
                              setTicketReplies((prev) => ({ ...prev, [t.id]: e.target.value }))
                            }
                            placeholder="Optional admin note to student (e.g., Fixed in latest update)"
                            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                          />
                          <button
                            type="button"
                            disabled={resolvingTicketId === t.id}
                            onClick={() => void handleResolveTicket(t)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 whitespace-nowrap cursor-pointer"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {resolvingTicketId === t.id ? 'Resolving...' : 'Mark as Resolved'}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div className="text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">
                          Resolved{t.resolvedAtMs ? ` on ${formatDateTimeShort(t.resolvedAtMs)}` : ''}
                          {t.adminReply ? ` · Note: "${t.adminReply}"` : ''}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* 7. DYNAMIC PLATFORM SETTINGS & FEATURE FLAGS */}
        {activeTab === 'settings' && <DynamicSettingsManagerPanel onNotify={notify} />}

        {/* 8. GITHUB CMS & LIVE CODE EDITOR */}
        {activeTab === 'github-editor' && <LiveCodeEditorPanel onNotify={notify} />}

        {activeTab !== 'analytics' && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
            <button
              type="button"
              onClick={handleBackAdminTab}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back to {tabHistory.length > 0 ? 'Previous Tab' : 'Deep Analytics'}</span>
            </button>
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#1e2431] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back to Top</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
};
