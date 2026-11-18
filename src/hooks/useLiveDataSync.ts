import { useCallback, useEffect, useState } from 'react';
import {
  dismissFailedSyncOp,
  getFailedSyncOps,
  getSyncHealthState,
  retryFailedSyncOps,
  subscribeAllPresence,
  subscribeAttempts,
  subscribeLeaderboard,
  subscribeMockTests,
  subscribeQuestions,
  subscribeReportedQueries,
  subscribeRevisionVault,
  subscribeSessionLogs,
  subscribeStudentsAdmin,
  subscribeSupportTickets,
  subscribeSyncHealthState,
  subscribeTasks,
  subscribeTestDrafts,
  subscribeVipInvites,
  subscribeXpLedger,
  syncPendingLocalOpsToCloud,
} from '../lib/firestoreService';
import type {
  CohortTaskDoc,
  LeaderboardEntry,
  MockTestDoc,
  QuestionDoc,
  ReportedQueryDoc,
  RevisionItemDoc,
  StudentPresenceDoc,
  StudentProfile,
  StudentSessionLogDoc,
  SupportTicketDoc,
  TestAttemptDoc,
  TestDraftDoc,
  VipInvite,
  XpLedgerEntryDoc,
} from '../types/exam';
import type { SyncHealthState } from '../utils/cloudFirstSync';
import type { FailedSyncOp } from '../utils/localFallbackStore';

export interface LiveDataSyncOptions {
  activeUid: string | null;
  isAdmin: boolean;
  isAdminPreview: boolean;
  isSignedIn: boolean;
}

export function useLiveDataSync(options: LiveDataSyncOptions) {
  const [invites, setInvites] = useState<VipInvite[]>([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [questions, setQuestions] = useState<QuestionDoc[]>([]);
  const [tests, setTests] = useState<MockTestDoc[]>([]);
  const [attempts, setAttempts] = useState<TestAttemptDoc[]>([]);
  const [tasks, setTasks] = useState<CohortTaskDoc[]>([]);
  const [revisionItems, setRevisionItems] = useState<RevisionItemDoc[]>([]);
  const [xpLedger, setXpLedger] = useState<XpLedgerEntryDoc[]>([]);
  const [presences, setPresences] = useState<StudentPresenceDoc[]>([]);
  const [sessionLogs, setSessionLogs] = useState<StudentSessionLogDoc[]>([]);
  const [testDrafts, setTestDrafts] = useState<TestDraftDoc[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicketDoc[]>([]);
  const [reportedQueries, setReportedQueries] = useState<ReportedQueryDoc[]>([]);

  const [syncHealth, setSyncHealth] = useState<SyncHealthState>(() => getSyncHealthState());
  const [failedOps, setFailedOps] = useState<FailedSyncOp[]>(() => getFailedSyncOps());

  useEffect(() => {
    const unsubHealth = subscribeSyncHealthState((state) => {
      setSyncHealth(state);
      setFailedOps(getFailedSyncOps());
    });
    const handleOnline = () => {
      void syncPendingLocalOpsToCloud({ force: true });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }
    return () => {
      unsubHealth();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
    };
  }, []);

  useEffect(() => {
    if (!options.isSignedIn || !options.activeUid) {
      setInvitesLoaded(false);
      return;
    }

    const { isAdmin, activeUid, isAdminPreview } = options;
    const unsubs = [
      subscribeLeaderboard(setLeaderboard),
      subscribeMockTests(isAdmin, setTests),
      subscribeTasks(setTasks),
      subscribeAttempts(isAdmin ? null : activeUid, setAttempts),
      subscribeXpLedger(isAdmin ? null : activeUid, setXpLedger),
      subscribeSessionLogs(isAdmin && !isAdminPreview ? null : activeUid, setSessionLogs),
      subscribeSupportTickets(isAdmin ? null : activeUid, setSupportTickets),
    ];

    if (isAdmin && !isAdminPreview) {
      unsubs.push(
        subscribeVipInvites((nextInvites) => {
          setInvites(nextInvites);
          setInvitesLoaded(true);
        }),
        subscribeStudentsAdmin(setStudents),
        subscribeQuestions(setQuestions),
        subscribeAllPresence(setPresences),
        subscribeReportedQueries(setReportedQueries)
      );
    } else {
      unsubs.push(
        subscribeRevisionVault(activeUid, setRevisionItems),
        subscribeTestDrafts(activeUid, setTestDrafts)
      );
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [options.isSignedIn, options.activeUid, options.isAdmin, options.isAdminPreview]);

  const retrySyncNow = useCallback(async () => {
    return syncPendingLocalOpsToCloud({ force: true });
  }, []);

  const retryFailedNow = useCallback(async (targetKey?: string) => {
    return retryFailedSyncOps(targetKey);
  }, []);

  const dismissFailedOpByKey = useCallback((key: string) => {
    dismissFailedSyncOp(key);
    setFailedOps(getFailedSyncOps());
  }, []);

  const resetSessionCollections = useCallback(() => {
    setTestDrafts([]);
    setSupportTickets([]);
    setInvitesLoaded(false);
  }, []);

  return {
    invites,
    invitesLoaded,
    students,
    leaderboard,
    questions,
    tests,
    attempts,
    tasks,
    revisionItems,
    xpLedger,
    presences,
    sessionLogs,
    testDrafts,
    supportTickets,
    reportedQueries,
    syncHealth,
    failedOps,
    retrySyncNow,
    retryFailedNow,
    dismissFailedOpByKey,
    resetSessionCollections,
  };
}
