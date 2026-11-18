import { useCallback, useEffect, useRef, useState } from 'react';
import { startStudentSessionLog, updateStudentSessionLog } from '../lib/firestoreService';
import { isFirestoreQuotaExceeded } from '../utils/firestoreQuota';
import { isRealCohortStudentUid } from '../utils/sessionAndOverrides';
import type { StudentProfile, SubjectKey } from '../types/exam';

interface UseStudentActivityTrackerParams {
  student: StudentProfile | null;
}

const IDLE_TIMEOUT_MS = 180_000; // 3 minutes of zero interaction pauses timer (prevents overnight AFK farming)
const FIRESTORE_SYNC_MS = 180_000; // Sync once every 3 minutes to preserve Firestore write quota while local UI ticks at 1s

export function useStudentActivityTracker({ student }: UseStudentActivityTrackerParams) {
  const sessionIdRef = useRef<string | null>(null);
  const activeSecRef = useRef(0);
  const testsCompletedRef = useRef(0);
  const questionsAttemptedRef = useRef(0);
  const subjectsRef = useRef<Set<SubjectKey>>(new Set());
  const titleRef = useRef<string>('Student Dashboard');

  const lastSyncedSignatureRef = useRef<string>('');

  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [liveActiveSec, setLiveActiveSec] = useState(0);

  const flushUpdate = useCallback((status: 'active' | 'ended') => {
    const sid = sessionIdRef.current;
    if (!sid || sid.startsWith('local_') || isFirestoreQuotaExceeded()) return;
    const signature = [
      sid,
      status,
      activeSecRef.current,
      testsCompletedRef.current,
      questionsAttemptedRef.current,
      subjectsRef.current.size,
      titleRef.current,
    ].join('|');
    if (status === 'active' && signature === lastSyncedSignatureRef.current) {
      return;
    }
    lastSyncedSignatureRef.current = signature;
    void updateStudentSessionLog({
      sessionId: sid,
      status,
      activeDurationSec: activeSecRef.current,
      testsCompleted: testsCompletedRef.current,
      questionsAttempted: questionsAttemptedRef.current,
      subjectsStudied: Array.from(subjectsRef.current),
      lastActivityTitle: titleRef.current,
      ...(status === 'ended' ? { logoutAtMs: Date.now() } : {}),
    }).catch(() => {});
  }, []);

  const setActivityContext = useCallback(
    (title: string, subjects?: SubjectKey[]) => {
      titleRef.current = title.slice(0, 120) || 'Student Dashboard';
      if (subjects) {
        for (const s of subjects) {
          subjectsRef.current.add(s);
        }
      }
      flushUpdate('active');
    },
    [flushUpdate]
  );

  const recordTestCompleted = useCallback(
    (questionsSolved: number, subjects?: SubjectKey[], isComplete: boolean = true) => {
      if (isComplete) {
        testsCompletedRef.current += 1;
      }
      questionsAttemptedRef.current += Math.max(0, questionsSolved);
      if (subjects) {
        for (const s of subjects) {
          subjectsRef.current.add(s);
        }
      }
      flushUpdate('active');
    },
    [flushUpdate]
  );

  const endSessionNow = useCallback(() => {
    flushUpdate('ended');
    sessionIdRef.current = null;
    setLiveSessionId(null);
    setLiveActiveSec(0);
  }, [flushUpdate]);

  // Start session log when student enters, tick wall-clock active seconds smoothly every 1s, and flush every 5s
  useEffect(() => {
    if (!student || !isRealCohortStudentUid(student.uid)) {
      if (sessionIdRef.current) {
        flushUpdate('ended');
        sessionIdRef.current = null;
      }
      setLiveSessionId(null);
      setLiveActiveSec(0);
      return;
    }

    let cancelled = false;
    activeSecRef.current = 0;
    testsCompletedRef.current = 0;
    questionsAttemptedRef.current = 0;
    subjectsRef.current = new Set();
    titleRef.current = 'Student Dashboard';
    setLiveSessionId(null);
    setLiveActiveSec(0);

    let lastInteractionMs = Date.now();
    let lastTickMs = Date.now();
    let accumulatedMs = 0;

    const markInteraction = () => {
      lastInteractionMs = Date.now();
    };

    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'pointermove',
      'pointerdown',
      'mousedown',
      'click',
      'keydown',
      'wheel',
      'touchstart',
      'scroll',
      'focus',
    ];
    for (const evt of events) {
      window.addEventListener(evt, markInteraction, { passive: true });
    }

    startStudentSessionLog({
      uid: student.uid,
      displayName: student.displayName,
      loginId: student.loginId,
      lastActivityTitle: 'Student Dashboard',
    })
      .then((sid) => {
        if (cancelled) {
          void updateStudentSessionLog({
            sessionId: sid,
            status: 'ended',
            activeDurationSec: activeSecRef.current,
            testsCompleted: testsCompletedRef.current,
            questionsAttempted: questionsAttemptedRef.current,
            subjectsStudied: Array.from(subjectsRef.current),
            lastActivityTitle: titleRef.current,
            logoutAtMs: Date.now(),
          }).catch(() => {});
          return;
        }
        sessionIdRef.current = sid;
        setLiveSessionId(sid);
      })
      .catch(() => {});

    const secTimer = window.setInterval(() => {
      const now = Date.now();
      const deltaMs = Math.min(3000, Math.max(0, now - lastTickMs));
      lastTickMs = now;

      const isActiveRecently = now - lastInteractionMs <= IDLE_TIMEOUT_MS;
      if (document.visibilityState === 'visible' && isActiveRecently) {
        accumulatedMs += deltaMs;
        if (accumulatedMs >= 1000) {
          const wholeSec = Math.floor(accumulatedMs / 1000);
          accumulatedMs -= wholeSec * 1000;
          activeSecRef.current += wholeSec;
          setLiveActiveSec(activeSecRef.current);
        }
      }
    }, 500);

    const syncTimer = window.setInterval(() => {
      flushUpdate('active');
    }, FIRESTORE_SYNC_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        lastTickMs = Date.now();
        lastInteractionMs = Date.now();
      } else {
        flushUpdate('active');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onPageHide = () => {
      flushUpdate('ended');
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      cancelled = true;
      window.clearInterval(secTimer);
      window.clearInterval(syncTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      for (const evt of events) {
        window.removeEventListener(evt, markInteraction);
      }
      if (sessionIdRef.current) {
        flushUpdate('ended');
        sessionIdRef.current = null;
      }
    };
  }, [student?.uid, flushUpdate]);

  return {
    liveSessionId,
    liveActiveSec,
    setActivityContext,
    recordTestCompleted,
    endSessionNow,
  };
}
