import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Keyboard,
  MonitorCheck,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { StudentProfile } from '../types/exam';
import {
  COMPUTER_KNOWLEDGE_QUESTIONS,
  COMPUTER_QUIZ_DURATION_SECONDS,
  computeDestTypingMetrics,
  DEST_DURATION_SECONDS,
  DEST_PASSAGES,
  DEST_TARGET_KEYSTROKES,
  scoreComputerQuiz,
} from '../utils/destSimulator';
import { formatSeconds } from '../utils/examEngine';

interface DestComputerSimulatorProps {
  student: StudentProfile;
  onBack: () => void;
}

type SimulatorTab = 'typing' | 'computer';

export const DestComputerSimulator: React.FC<DestComputerSimulatorProps> = ({
  student,
  onBack,
}) => {
  const [activeTab, setActiveTab] = useState<SimulatorTab>('typing');

  // --- Module A: DEST Typing Test State ---
  const [selectedPassageId, setSelectedPassageId] = useState<string>(DEST_PASSAGES[0].id);
  const [typedText, setTypedText] = useState('');
  const [typingRunning, setTypingRunning] = useState(false);
  const [typingSecondsLeft, setTypingSecondsLeft] = useState(DEST_DURATION_SECONDS);
  const [typingSubmitted, setTypingSubmitted] = useState(false);
  const [pasteBlockedNotice, setPasteBlockedNotice] = useState(false);
  const typingAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingDeadlineRef = useRef<number | null>(null);

  const activePassage = useMemo(
    () => DEST_PASSAGES.find((p) => p.id === selectedPassageId) ?? DEST_PASSAGES[0],
    [selectedPassageId]
  );

  const typingElapsedSec = Math.max(1, DEST_DURATION_SECONDS - typingSecondsLeft);
  const typingMetrics = useMemo(
    () => computeDestTypingMetrics(activePassage.text, typedText, typingElapsedSec),
    [activePassage.text, typedText, typingElapsedSec]
  );

  useEffect(() => {
    if (!typingRunning || typingSubmitted) {
      typingDeadlineRef.current = null;
      return;
    }
    if (!typingDeadlineRef.current) {
      typingDeadlineRef.current = Date.now() + typingSecondsLeft * 1000;
    }
    const syncTypingClock = () => {
      if (!typingDeadlineRef.current) return;
      const remaining = Math.max(0, Math.ceil((typingDeadlineRef.current - Date.now()) / 1000));
      setTypingSecondsLeft(remaining);
      if (remaining <= 0) {
        setTypingRunning(false);
        setTypingSubmitted(true);
      }
    };
    const timer = window.setInterval(syncTypingClock, 500);
    return () => window.clearInterval(timer);
    // Intentionally omit typingSecondsLeft so deadline remains anchored across ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typingRunning, typingSubmitted]);

  const handleResetTyping = (nextPassageId?: string) => {
    if (nextPassageId) setSelectedPassageId(nextPassageId);
    typingDeadlineRef.current = null;
    setTypedText('');
    setTypingRunning(false);
    setTypingSecondsLeft(DEST_DURATION_SECONDS);
    setTypingSubmitted(false);
    setPasteBlockedNotice(false);
  };

  const handleTypingChange = (nextValue: string) => {
    if (typingSubmitted) return;
    if (!typingRunning && nextValue.length > 0) {
      typingDeadlineRef.current = Date.now() + typingSecondsLeft * 1000;
      setTypingRunning(true);
    }
    const capped = nextValue.slice(0, Math.max(DEST_TARGET_KEYSTROKES + 50, activePassage.text.length));
    setTypedText(capped);
    if (capped.length >= DEST_TARGET_KEYSTROKES) {
      setTypingRunning(false);
      setTypingSubmitted(true);
    }
  };

  // --- Module B: Computer Knowledge Quiz State ---
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizSecondsLeft, setQuizSecondsLeft] = useState(COMPUTER_QUIZ_DURATION_SECONDS);
  const [quizCurrentIdx, setQuizCurrentIdx] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizMarked, setQuizMarked] = useState<Record<string, boolean>>({});
  const [quizVisited, setQuizVisited] = useState<Record<string, boolean>>({
    [COMPUTER_KNOWLEDGE_QUESTIONS[0].id]: true,
  });
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const quizDeadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (!quizStarted || quizSubmitted) {
      quizDeadlineRef.current = null;
      return;
    }
    if (!quizDeadlineRef.current) {
      quizDeadlineRef.current = Date.now() + quizSecondsLeft * 1000;
    }
    const syncQuizClock = () => {
      if (!quizDeadlineRef.current) return;
      const remaining = Math.max(0, Math.ceil((quizDeadlineRef.current - Date.now()) / 1000));
      setQuizSecondsLeft(remaining);
      if (remaining <= 0) {
        setQuizSubmitted(true);
      }
    };
    const timer = window.setInterval(syncQuizClock, 500);
    return () => window.clearInterval(timer);
    // Intentionally omit quizSecondsLeft so deadline remains anchored across ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizStarted, quizSubmitted]);

  const quizOutcome = useMemo(
    () => (quizSubmitted ? scoreComputerQuiz(COMPUTER_KNOWLEDGE_QUESTIONS, quizAnswers) : null),
    [quizSubmitted, quizAnswers]
  );

  const activeQuizQuestion = COMPUTER_KNOWLEDGE_QUESTIONS[quizCurrentIdx];

  const handleResetQuiz = () => {
    quizDeadlineRef.current = null;
    setQuizStarted(false);
    setQuizSecondsLeft(COMPUTER_QUIZ_DURATION_SECONDS);
    setQuizCurrentIdx(0);
    setQuizAnswers({});
    setQuizMarked({});
    setQuizVisited({ [COMPUTER_KNOWLEDGE_QUESTIONS[0].id]: true });
    setQuizSubmitted(false);
  };

  const navigateQuizQuestion = (idx: number) => {
    if (idx < 0 || idx >= COMPUTER_KNOWLEDGE_QUESTIONS.length) return;
    const target = COMPUTER_KNOWLEDGE_QUESTIONS[idx];
    setQuizVisited((prev) => ({ ...prev, [target.id]: true }));
    setQuizCurrentIdx(idx);
    if (!quizStarted) setQuizStarted(true);
  };

  const selectQuizOption = (optIndex: number) => {
    if (quizSubmitted) return;
    if (!quizStarted) setQuizStarted(true);
    setQuizVisited((prev) => ({ ...prev, [activeQuizQuestion.id]: true }));
    setQuizAnswers((prev) => ({ ...prev, [activeQuizQuestion.id]: optIndex }));
  };

  const renderPassagePreview = () => {
    const target = activePassage.text;
    const windowStart = Math.max(0, typedText.length - 120);
    const windowEnd = Math.min(target.length, windowStart + 720);
    const prefixEllipsis = windowStart > 0 ? '...' : '';
    const suffixEllipsis = windowEnd < target.length ? '...' : '';

    const chars = target.slice(windowStart, windowEnd).split('');
    return (
      <div
        aria-label="Reference typing passage"
        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f141d] p-4 font-mono text-sm leading-7 tracking-wide select-none text-slate-700 dark:text-slate-300"
      >
        {prefixEllipsis && <span className="text-slate-400">{prefixEllipsis} </span>}
        {chars.map((ch, offset) => {
          const absIdx = windowStart + offset;
          let cls = 'text-slate-700 dark:text-slate-300';
          if (absIdx < typedText.length) {
            if (typedText[absIdx] === ch) {
              cls = 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300';
            } else {
              cls = 'bg-red-100 dark:bg-red-950/70 text-red-800 dark:text-red-300 underline';
            }
          } else if (absIdx === typedText.length) {
            cls = 'bg-blue-600 text-white rounded-xs px-0.5';
          }
          return (
            <span key={absIdx} className={cls}>
              {ch}
            </span>
          );
        })}
        {suffixEllipsis && <span className="text-slate-400"> {suffixEllipsis}</span>}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-[#0b0f17] text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Bar */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#18202c] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back to Dashboard</span>
            </button>
            <div>
              <h1 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                DEST &amp; Computer Knowledge Simulator
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {student.displayName} · Target: {student.targetPost} · SSC CGL Tier-II Qualifying Skill Suite
              </p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="DEST and Computer Modules"
            className="flex flex-wrap max-w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#0f141d] p-1 gap-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'typing'}
              onClick={() => setActiveTab('typing')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                activeTab === 'typing'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Keyboard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>DEST Typing (15m · 2000 Keys)</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'computer'}
              onClick={() => setActiveTab('computer')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                activeTab === 'computer'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <MonitorCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Computer Knowledge (20 Qs · 15m)</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {activeTab === 'typing' ? (
          <section className="space-y-5">
            {/* Controls & Passage Selector */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label htmlFor="dest-passage-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Official Passage:
                  </label>
                  <select
                    id="dest-passage-select"
                    value={activePassage.id}
                    disabled={typingRunning && !typingSubmitted}
                    onChange={(e) => handleResetTyping(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f141d] px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  >
                    {DEST_PASSAGES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.difficulty} · {p.text.length} chars)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!typingRunning && !typingSubmitted && (
                    <button
                      type="button"
                      onClick={() => {
                        setTypingRunning(true);
                        typingAreaRef.current?.focus();
                      }}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    >
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Start 15-Min DEST Timer</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleResetTyping()}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#18202c] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Reset</span>
                  </button>
                  {!typingSubmitted && (
                    <button
                      type="button"
                      disabled={typedText.length === 0}
                      onClick={() => {
                        setTypingRunning(false);
                        setTypingSubmitted(true);
                      }}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Submit Typing Test</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Metrics Strip */}
              <div className="grid grid-cols-2 gap-3 border-t border-slate-200 dark:border-slate-800 pt-4 sm:grid-cols-5">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] px-3.5 py-2.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Time Remaining</div>
                  <div
                    className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${
                      typingSecondsLeft <= 60 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {formatSeconds(typingSecondsLeft)}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] px-3.5 py-2.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Key Depressions</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                    {typingMetrics.keyDepressions} / {DEST_TARGET_KEYSTROKES}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] px-3.5 py-2.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Accuracy</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {typingMetrics.accuracy}%
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] px-3.5 py-2.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Error Rate</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                    {typingMetrics.errorPercentage}% ({typingMetrics.errorCount})
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] px-3.5 py-2.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Net Typing Speed</div>
                  <div className="mt-0.5 font-mono text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                    {typingMetrics.netWpm} WPM
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <span>2000 Key Depressions Progress</span>
                  <span className="font-mono tabular-nums">{typingMetrics.progressPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-blue-700 dark:bg-blue-500 transition-all"
                    style={{ width: `${typingMetrics.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {typingSubmitted && (
              <div
                className={`rounded-2xl border p-5 space-y-3 ${
                  typingMetrics.qualified
                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30'
                    : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck
                      className={`h-5 w-5 ${
                        typingMetrics.qualified
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                      aria-hidden="true"
                    />
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      {typingMetrics.qualified
                        ? 'DEST Qualifying Standard Met (2000+ Keys · <=5% Error)'
                        : 'DEST Practice Assessment Completed'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleResetTyping()}
                    className="rounded-lg bg-slate-900 dark:bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 font-mono tabular-nums">
                  <div>Keystrokes: <strong>{typingMetrics.keyDepressions} / 2000</strong></div>
                  <div>Correct Chars: <strong>{typingMetrics.correctChars}</strong></div>
                  <div>Errors: <strong>{typingMetrics.errorCount} ({typingMetrics.errorPercentage}%)</strong></div>
                  <div>Gross / Net WPM: <strong>{typingMetrics.grossWpm} / {typingMetrics.netWpm}</strong></div>
                </div>
              </div>
            )}

            {/* Passage + Typing Area */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-5 space-y-4">
              {renderPassagePreview()}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="dest-typing-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Type here (Timer starts automatically on your first keystroke · Copy/Paste disabled)
                  </label>
                  {pasteBlockedNotice && (
                    <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                      Paste is disabled in SSC CGL DEST exam mode.
                    </span>
                  )}
                </div>
                <textarea
                  ref={typingAreaRef}
                  id="dest-typing-input"
                  rows={7}
                  value={typedText}
                  disabled={typingSubmitted}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  onPaste={(e) => {
                    e.preventDefault();
                    setPasteBlockedNotice(true);
                  }}
                  onChange={(e) => handleTypingChange(e.target.value)}
                  placeholder="Begin typing the reference passage above accurately to count key depressions..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f141d] p-4 font-mono text-sm leading-6 text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none disabled:opacity-65"
                />
              </div>
            </div>
          </section>
        ) : (
          <section className="space-y-5">
            {quizSubmitted && quizOutcome ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                        SSC CGL Tier-II Computer Knowledge Scorecard
                      </p>
                      <h2 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                        {quizOutcome.score} / {quizOutcome.maxScore}{' '}
                        <span
                          className={`ml-2 text-sm font-semibold ${
                            quizOutcome.qualifyingPassed
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-700 dark:text-red-400'
                          }`}
                        >
                          ({quizOutcome.qualifyingPassed ? 'UR Qualifying >=18 Passed' : 'Below UR Qualifying (18/60)'})
                        </span>
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetQuiz}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Retake Computer Quiz</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-slate-200 dark:border-slate-800 pt-4 sm:grid-cols-4 font-mono text-xs tabular-nums">
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3 text-emerald-900 dark:text-emerald-200">
                      Correct (+3): <strong className="text-base">{quizOutcome.correctCount}</strong>
                    </div>
                    <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3 text-red-900 dark:text-red-200">
                      Wrong (-1): <strong className="text-base">{quizOutcome.wrongCount}</strong>
                    </div>
                    <div className="rounded-lg bg-slate-100 dark:bg-slate-800/70 p-3 text-slate-800 dark:text-slate-200">
                      Unattempted: <strong className="text-base">{quizOutcome.unattemptedCount}</strong>
                    </div>
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-blue-900 dark:text-blue-200">
                      Accuracy: <strong className="text-base">{quizOutcome.accuracy}%</strong>
                    </div>
                  </div>
                </div>

                {/* Detailed Review */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-6 space-y-4">
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    Solution &amp; Concept Review (All 20 Questions)
                  </h3>
                  <div className="space-y-3">
                    {COMPUTER_KNOWLEDGE_QUESTIONS.map((q, idx) => {
                      const picked = quizAnswers[q.id];
                      const isCorrect = picked === q.correctIndex;
                      const isSkipped = picked === undefined;
                      return (
                        <div
                          key={q.id}
                          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f141d] p-4 space-y-2 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-blue-700 dark:text-blue-400">
                              Q{idx + 1} · {q.topic}
                            </span>
                            {isCorrect ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                Correct (+3)
                              </span>
                            ) : isSkipped ? (
                              <span className="font-semibold text-slate-500 dark:text-slate-400">
                                Unattempted (0)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                Wrong (-1)
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {q.question}
                          </p>
                          <div className="text-slate-700 dark:text-slate-300">
                            Correct Answer: <strong>{q.options[q.correctIndex]}</strong>
                            {!isSkipped && !isCorrect && (
                              <span className="ml-3 text-red-600 dark:text-red-400">
                                Your Pick: {q.options[picked]}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-600 dark:text-slate-400">{q.explanation}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Active Question Panel */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-6 space-y-5 lg:col-span-8">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div>
                      <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                        {activeQuizQuestion.topic}
                      </span>
                      <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                        Question {quizCurrentIdx + 1} of {COMPUTER_KNOWLEDGE_QUESTIONS.length}
                      </h2>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f141d] px-2.5 py-1 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                        +3 / -1
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 font-mono text-sm font-bold tabular-nums ${
                          quizSecondsLeft <= 60
                            ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                            : 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-[#0f141d] dark:text-white'
                        }`}
                      >
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatSeconds(quizSecondsLeft)}
                      </span>
                    </div>
                  </div>

                  <p className="text-base font-medium leading-relaxed text-slate-900 dark:text-slate-100">
                    {activeQuizQuestion.question}
                  </p>

                  <div className="space-y-2.5">
                    {activeQuizQuestion.options.map((opt, optIdx) => {
                      const picked = quizAnswers[activeQuizQuestion.id] === optIdx;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => selectQuizOption(optIdx)}
                          className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors cursor-pointer ${
                            picked
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100 font-semibold'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0f141d] text-slate-800 dark:text-slate-200 hover:border-blue-400'
                          }`}
                        >
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-bold ${
                              picked
                                ? 'border-blue-600 bg-blue-700 text-white'
                                : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {String.fromCharCode(65 + optIdx)}
                          </span>
                          <span>{opt}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setQuizAnswers((prev) => {
                            const next = { ...prev };
                            delete next[activeQuizQuestion.id];
                            return next;
                          });
                        }}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Clear Response
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQuizMarked((prev) => ({
                            ...prev,
                            [activeQuizQuestion.id]: !prev[activeQuizQuestion.id],
                          }));
                          if (quizCurrentIdx + 1 < COMPUTER_KNOWLEDGE_QUESTIONS.length) {
                            navigateQuizQuestion(quizCurrentIdx + 1);
                          }
                        }}
                        className="rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 px-3 py-2 text-xs font-semibold text-violet-900 dark:text-violet-200 hover:bg-violet-100 cursor-pointer"
                      >
                        {quizMarked[activeQuizQuestion.id] ? 'Unmark Review' : 'Mark & Next'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={quizCurrentIdx === 0}
                        onClick={() => navigateQuizQuestion(quizCurrentIdx - 1)}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-45 cursor-pointer"
                      >
                        Previous
                      </button>
                      {quizCurrentIdx + 1 < COMPUTER_KNOWLEDGE_QUESTIONS.length ? (
                        <button
                          type="button"
                          onClick={() => navigateQuizQuestion(quizCurrentIdx + 1)}
                          className="rounded-lg bg-blue-700 hover:bg-blue-800 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                        >
                          Save &amp; Next
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setQuizSubmitted(true)}
                          className="rounded-lg bg-emerald-700 hover:bg-emerald-800 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                        >
                          Submit Computer Quiz
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Palette Sidebar */}
                <aside className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-5 space-y-4 lg:col-span-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                      Question Palette (1–20)
                    </h3>
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {Object.keys(quizAnswers).length}/20 answered
                    </span>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    {COMPUTER_KNOWLEDGE_QUESTIONS.map((q, idx) => {
                      const isAns = quizAnswers[q.id] !== undefined;
                      const isMark = Boolean(quizMarked[q.id]);
                      const isVis = Boolean(quizVisited[q.id]);
                      let btnCls =
                        'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-[#0f141d] dark:text-slate-300';
                      if (isAns && isMark) {
                        btnCls = 'border-violet-600 bg-violet-700 text-white ring-2 ring-emerald-400';
                      } else if (isMark) {
                        btnCls = 'border-violet-600 bg-violet-700 text-white';
                      } else if (isAns) {
                        btnCls = 'border-emerald-600 bg-emerald-600 text-white';
                      } else if (isVis) {
                        btnCls = 'border-red-500 bg-red-600 text-white';
                      }
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => navigateQuizQuestion(idx)}
                          className={`h-9 rounded-lg border font-mono text-xs font-bold tabular-nums cursor-pointer ${btnCls} ${
                            idx === quizCurrentIdx ? 'ring-2 ring-blue-500 ring-offset-1' : ''
                          }`}
                        >
                          {idx + 1}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setQuizSubmitted(true)}
                    className="w-full rounded-lg bg-emerald-700 hover:bg-emerald-800 px-4 py-2.5 text-xs font-semibold text-white cursor-pointer"
                  >
                    Submit Computer Quiz Now
                  </button>
                </aside>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
};
