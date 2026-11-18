import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Layers, Play, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import {
  createCustomMockFromBank,
  fetchAllQuestionsOnce,
  getNormalizedStarterQuestions,
} from '../lib/firestoreService';
import {
  SUBJECT_LABELS,
  type MockTestDoc,
  type QuestionDoc,
  type ScoringConfig,
  type SubjectKey,
} from '../types/exam';
import { extractCustomMockFilterCatalog } from '../utils/examEngine';

interface CustomMockBuilderModalProps {
  uid: string;
  scoringConfig: ScoringConfig;
  onClose: () => void;
  onTestCreated: (test: MockTestDoc) => void;
}

const SUBJECT_KEYS: SubjectKey[] = ['quant', 'reasoning', 'english', 'ga'];

export const CustomMockBuilderModal: React.FC<CustomMockBuilderModalProps> = ({
  uid,
  scoringConfig,
  onClose,
  onTestCreated,
}) => {
  const [bankQuestions, setBankQuestions] = useState<QuestionDoc[]>(() =>
    getNormalizedStarterQuestions()
  );
  const [loadingBank, setLoadingBank] = useState(true);
  const [filterValue, setFilterValue] = useState<string>('all');
  const [questionCount, setQuestionCount] = useState<number>(25);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(30);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingBank(true);
    fetchAllQuestionsOnce()
      .then((qs) => {
        if (active && qs.length > 0) setBankQuestions(qs);
      })
      .catch(() => {
        // Keep initialized starter bank cleanly
      })
      .finally(() => {
        if (active) setLoadingBank(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const catalog = useMemo(
    () => extractCustomMockFilterCatalog(bankQuestions),
    [bankQuestions]
  );

  const selectedExactCount = useMemo(() => {
    if (filterValue === 'all') return catalog.totalCount;
    if (filterValue.startsWith('subject:')) {
      const sub = filterValue.slice('subject:'.length) as SubjectKey;
      return catalog.subjectCounts[sub] ?? 0;
    }
    if (filterValue.startsWith('topic:')) {
      return catalog.topics.find((t) => t.value === filterValue)?.count ?? 0;
    }
    return catalog.totalCount;
  }, [catalog, filterValue]);

  const handleStartCustomTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setCreating(true);
    try {
      const safeCount = Math.max(5, Math.min(50, Math.round(questionCount || 10)));
      const safeMinutes = Math.max(5, Math.min(90, Math.round(timeLimitMinutes || 10)));
      const created = await createCustomMockFromBank({
        uid,
        filterValue,
        count: safeCount,
        durationMinutes: safeMinutes,
        scoringConfig,
      });
      onTestCreated(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to build custom mock test.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-mock-builder-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
    >
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <div>
              <h2
                id="custom-mock-builder-title"
                className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
              >
                Custom Mock Test Builder
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pick any Subject or Topic, Question Count, and Timer for a fresh randomized test
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Custom Mock Test Builder"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleStartCustomTest} className="p-6 space-y-6">
          {errorMsg && (
            <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-xs font-medium text-red-900 dark:text-red-200">
              {errorMsg}
            </div>
          )}

          {/* Input 1: Subject / Topic Dropdown */}
          <div className="space-y-1.5">
            <label
              htmlFor="custom-mock-subject-topic"
              className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              <span className="inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <span>1. Subject / Topic</span>
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {selectedExactCount} matching in bank{loadingBank ? ' · syncing...' : ''}
              </span>
            </label>
            <select
              id="custom-mock-subject-topic"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#11151d] px-3.5 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
            >
              <option value="all">
                All Subjects Combined ({catalog.totalCount} Qs)
              </option>
              <optgroup label="By SSC CGL Subject">
                <option value="subject:quant">
                  Maths / Quantitative Aptitude ({catalog.subjectCounts.quant} Qs)
                </option>
                <option value="subject:reasoning">
                  General Intelligence &amp; Reasoning ({catalog.subjectCounts.reasoning} Qs)
                </option>
                <option value="subject:english">
                  English Comprehension ({catalog.subjectCounts.english} Qs)
                </option>
                <option value="subject:ga">
                  General Awareness / GS ({catalog.subjectCounts.ga} Qs)
                </option>
              </optgroup>
              {SUBJECT_KEYS.map((sub) => {
                const subTopics = catalog.topics.filter((t) => t.subject === sub);
                if (subTopics.length === 0) return null;
                return (
                  <optgroup key={sub} label={`${SUBJECT_LABELS[sub].short} Topics`}>
                    {subTopics.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.topic} ({t.count} Qs)
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {filterValue.startsWith('topic:') && selectedExactCount < questionCount && !loadingBank && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Note: This specific topic currently has {selectedExactCount} questions; remaining slots will auto-fill from the same subject so you get {questionCount} questions.
              </p>
            )}
          </div>

          {/* Input 2: Number of Questions */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="custom-mock-q-count-input"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                <Sparkles className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <span>2. Number of Questions</span>
              </label>
              <div className="flex items-center gap-2">
                {([10, 25, 50] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setQuestionCount(preset)}
                    className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                      questionCount === preset
                        ? 'bg-blue-700 text-white'
                        : 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
                <input
                  id="custom-mock-q-count-input"
                  type="number"
                  min={5}
                  max={50}
                  value={questionCount}
                  onChange={(e) =>
                    setQuestionCount(Math.max(5, Math.min(50, Number(e.target.value) || 5)))
                  }
                  className="w-16 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#11151d] px-2.5 py-1 text-right font-mono text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>
            </div>
            <input
              aria-label="Number of Questions Slider"
              type="range"
              min={5}
              max={50}
              step={1}
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value))}
              className="w-full accent-blue-700 cursor-pointer"
            />
            <div className="flex justify-between font-mono text-[10px] text-slate-400 dark:text-slate-500">
              <span>5 Qs</span>
              <span>25 Qs</span>
              <span>50 Qs</span>
            </div>
          </div>

          {/* Input 3: Time Limit (Minutes) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="custom-mock-time-input"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                <Clock className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <span>3. Time Limit (Minutes)</span>
              </label>
              <div className="flex items-center gap-2">
                {([10, 30, 60] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTimeLimitMinutes(preset)}
                    className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                      timeLimitMinutes === preset
                        ? 'bg-blue-700 text-white'
                        : 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1e2431] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset}m
                  </button>
                ))}
                <input
                  id="custom-mock-time-input"
                  type="number"
                  min={5}
                  max={90}
                  value={timeLimitMinutes}
                  onChange={(e) =>
                    setTimeLimitMinutes(Math.max(5, Math.min(90, Number(e.target.value) || 5)))
                  }
                  className="w-16 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#11151d] px-2.5 py-1 text-right font-mono text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>
            </div>
            <input
              aria-label="Time Limit Minutes Slider"
              type="range"
              min={5}
              max={90}
              step={1}
              value={timeLimitMinutes}
              onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
              className="w-full accent-blue-700 cursor-pointer"
            />
            <div className="flex justify-between font-mono text-[10px] text-slate-400 dark:text-slate-500">
              <span>5 Min</span>
              <span>30 Min</span>
              <span>60 Min</span>
              <span>90 Min</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-4 py-3 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
            <span>
              Scoring: <strong>+{scoringConfig.pointsPerCorrect}</strong> /{' '}
              <strong>-{scoringConfig.negativeMarks}</strong> · Bilingual <strong>A/अ</strong> ready
            </span>
            <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
              {questionCount} Qs · {timeLimitMinutes} Min
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 dark:border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || bankQuestions.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{creating ? 'Building Fresh Test...' : 'Start Test'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
