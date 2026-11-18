import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  CalendarCheck,
  Check,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import type { CohortTaskDoc, MockTestDoc, SupportTicketDoc } from '../types/exam';
import {
  DAILY_MOCK_PREFIX,
  getLocalDateKey,
  isDailyMockTest,
  isDailySectionalTest,
  isTaskExpired,
  TICKET_RESOLVED_PUSH_MESSAGE,
} from '../utils/examEngine';
import { aiFetchSscUpdates } from '../lib/aiClient';

export interface SscGroundUpdate {
  id: string;
  title: string;
  summary: string;
  category: 'Exam Notice' | 'Calendar' | 'Pattern / Syllabus' | 'Preparation';
  url?: string;
}

export interface NotificationBellProps {
  tests?: MockTestDoc[];
  tasks?: CohortTaskDoc[];
  supportTickets?: SupportTicketDoc[];
  pendingVaultCount?: number;
  onLaunchTest?: (test: MockTestDoc) => void;
  onNavigateTab?: (tabId: string) => void;
  onAckSupportTicket?: (ticketId: string) => void;
}

const SEEN_STORAGE_KEY = 'getcgl_notif_seen_v1';

interface NotifItem {
  id: string;
  kind: 'ssc' | 'daily' | 'test' | 'task' | 'vault' | 'ticket';
  badge: string;
  title: string;
  body: string;
  externalUrl?: string;
  testObj?: MockTestDoc;
  targetTab?: string;
  ticketId?: string;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  tests = [],
  tasks = [],
  supportTickets = [],
  pendingVaultCount = 0,
  onLaunchTest,
  onNavigateTab,
  onAckSupportTicket,
}) => {
  const [open, setOpen] = useState(false);
  const [sscUpdates, setSscUpdates] = useState<SscGroundUpdate[]>([]);
  const [sscSource, setSscSource] = useState<'live_grounded' | 'offline' | 'loading'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SEEN_STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
    } catch {
      return new Set();
    }
  });

  const panelRef = useRef<HTMLDivElement | null>(null);

  const loadSscUpdates = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    try {
      const data = await aiFetchSscUpdates(forceRefresh);
      setSscUpdates(data.updates);
      setSscSource(data.source);
    } catch {
      setSscSource('offline');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadSscUpdates(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const notifications = useMemo<NotifItem[]>(() => {
    const items: NotifItem[] = [];
    const todayKey = getLocalDateKey();

    // 0. Resolved Support Tickets
    for (const tk of supportTickets) {
      if (tk.status === 'resolved') {
        items.push({
          id: `notif_ticket_${tk.id}`,
          kind: 'ticket',
          badge: 'Support Resolved',
          title: `Ticket Resolved: ${tk.subject}`,
          body: `${TICKET_RESOLVED_PUSH_MESSAGE}${tk.adminReply ? ` Admin Note: ${tk.adminReply}` : ''}`,
          ticketId: tk.id,
        });
      }
    }

    // 1. Today's Auto Daily Full Mock & Daily Sectionals
    const todayMock = tests.find((t) => t.id === `${DAILY_MOCK_PREFIX}${todayKey}`);
    if (todayMock) {
      items.push({
        id: `notif_${todayMock.id}`,
        kind: 'daily',
        badge: 'Today Daily Mock',
        title: todayMock.title,
        body: `${todayMock.questionCount} fresh bilingual questions (${todayMock.durationMinutes} min) ready to attempt.`,
        testObj: todayMock,
        targetTab: 'overview',
      });
    }

    const todaySectionals = tests.filter(
      (t) => isDailySectionalTest(t.id) && t.id.endsWith(todayKey)
    );
    if (todaySectionals.length > 0) {
      items.push({
        id: `notif_sec_${todayKey}_${todaySectionals.length}`,
        kind: 'daily',
        badge: 'Daily Sectionals',
        title: `${todaySectionals.length} Daily Sectional Drills Ready`,
        body: `${todaySectionals.map((s) => s.subjectScope.toUpperCase()).join(', ')} section-wise sprints updated for ${todayKey.replace(/_/g, '-')}.`,
        testObj: todaySectionals[0],
        targetTab: 'overview',
      });
    }

    // 2. Recent Admin-Published Mocks (excluding daily auto & prac)
    const customTests = tests
      .filter((t) => t.published && !isDailyMockTest(t.id) && !isDailySectionalTest(t.id) && !t.id.startsWith('prac_'))
      .slice(0, 3);
    for (const t of customTests) {
      items.push({
        id: `notif_test_${t.id}`,
        kind: 'test',
        badge: 'Mock / Quiz',
        title: `New Test: ${t.title}`,
        body: `${t.questionCount} questions · ${t.durationMinutes} min · +${t.positiveMarks}/-${t.negativeMarks}`,
        testObj: t,
        targetTab: 'overview',
      });
    }

    // 3. Active Cohort Tasks
    const activeTasks = tasks.filter((t) => t.active && !isTaskExpired(t)).slice(0, 2);
    for (const tk of activeTasks) {
      items.push({
        id: `notif_task_${tk.id}`,
        kind: 'task',
        badge: 'Mission Alert',
        title: tk.title,
        body: `Complete ${tk.targetTests} test(s) by ${tk.dueDate} for +${tk.bonusXp} Base XP.`,
        targetTab: 'overview',
      });
    }

    // 4. Pending Revision Vault Alert
    if (pendingVaultCount > 0) {
      items.push({
        id: `notif_vault_${pendingVaultCount}`,
        kind: 'vault',
        badge: 'Revision Vault',
        title: `${pendingVaultCount} Pending Mistake(s) in Vault`,
        body: 'Re-test your wrong and skipped questions to turn them Mastered.',
        targetTab: 'vault',
      });
    }

    // 5. Real SSC CGL Grounded Exam Updates
    for (const u of sscUpdates) {
      items.push({
        id: u.id,
        kind: 'ssc',
        badge: u.category,
        title: u.title,
        body: u.summary,
        externalUrl: u.url,
      });
    }

    return items;
  }, [tests, tasks, supportTickets, pendingVaultCount, sscUpdates]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !seenIds.has(n.id)).length,
    [notifications, seenIds]
  );

  const persistSeen = (nextSet: Set<string>) => {
    setSeenIds(nextSet);
    try {
      localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Array.from(nextSet).slice(-120)));
    } catch {
      // Ignore storage quota errors
    }
  };

  const markRead = (id: string, ticketId?: string) => {
    if (ticketId) {
      onAckSupportTicket?.(ticketId);
    }
    if (seenIds.has(id)) return;
    const next = new Set(seenIds);
    next.add(id);
    persistSeen(next);
  };

  const markAllRead = () => {
    const next = new Set(seenIds);
    notifications.forEach((n) => {
      next.add(n.id);
      if (n.ticketId) onAckSupportTicket?.(n.ticketId);
    });
    persistSeen(next);
  };

  const renderIcon = (kind: NotifItem['kind']) => {
    if (kind === 'ticket') return <Check className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />;
    if (kind === 'daily') return <CalendarCheck className="h-4 w-4 text-blue-700 shrink-0" aria-hidden="true" />;
    if (kind === 'test') return <BookOpen className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />;
    if (kind === 'task') return <Target className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />;
    if (kind === 'vault') return <Sparkles className="h-4 w-4 text-violet-700 shrink-0" aria-hidden="true" />;
    return <Bell className="h-4 w-4 text-slate-700 shrink-0" aria-hidden="true" />;
  };

  return (
    <div ref={panelRef} className="relative no-print">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Notifications (${unreadCount} unread)`}
        aria-expanded={open}
        className="relative inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2533] p-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 font-mono text-[10px] font-bold text-white tabular-nums">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="SSC CGL Updates and Question Alerts"
          className="fixed inset-x-3 top-16 z-50 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#181d27] shadow-xl overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-4 py-3">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                SSC CGL Alerts &amp; New Questions
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {sscSource === 'live_grounded'
                  ? 'Live SSC updates + new daily mocks & drills'
                  : 'New daily mocks, sectional drills & active tasks'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void loadSscUpdates(true)}
                disabled={refreshing}
                title="Refresh SSC CGL News"
                aria-label="Refresh SSC CGL notifications"
                className="rounded-md p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
                className="rounded-md p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                All caught up! New daily questions, sectional tests, and SSC CGL notices appear here.
              </div>
            ) : (
              notifications.map((item) => {
                const isUnread = !seenIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 transition-colors ${
                      isUnread
                        ? 'bg-blue-50/40 dark:bg-blue-950/20'
                        : 'bg-white dark:bg-[#181d27]'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5">{renderIcon(item.kind)}</div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                            {item.badge}
                          </span>
                          {isUnread && (
                            <span className="h-2 w-2 rounded-full bg-blue-600" aria-label="Unread" />
                          )}
                        </div>
                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                          {item.title}
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{item.body}</p>
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          {item.testObj && onLaunchTest && (
                            <button
                              type="button"
                              onClick={() => {
                                markRead(item.id);
                                setOpen(false);
                                onLaunchTest(item.testObj!);
                              }}
                              className="text-[11px] font-bold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                              Attempt Now &rarr;
                            </button>
                          )}
                          {!item.testObj && item.targetTab && onNavigateTab && (
                            <button
                              type="button"
                              onClick={() => {
                                markRead(item.id);
                                setOpen(false);
                                onNavigateTab(item.targetTab!);
                              }}
                              className="text-[11px] font-bold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                              Open Section &rarr;
                            </button>
                          )}
                          {item.externalUrl && (
                            <a
                              href={item.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => markRead(item.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                            >
                              <span>Official Source</span>
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          )}
                          {isUnread && (
                            <button
                              type="button"
                              onClick={() => markRead(item.id, item.ticketId)}
                              className="ml-auto text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {notifications.length > 0 && unreadCount > 0 && (
            <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-4 py-2 text-right">
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <Check className="h-3 w-3" aria-hidden="true" />
                <span>Mark all as read</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
