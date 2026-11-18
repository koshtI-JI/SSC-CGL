import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, BookmarkCheck, FileText, Search, X } from 'lucide-react';
import type { MockTestDoc, QuestionDoc, RevisionItemDoc, SubjectKey } from '../types/exam';
import { searchGlobalStudyItems, type GlobalSearchMatch } from '../utils/sessionAndOverrides';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  tests: MockTestDoc[];
  revisionItems: RevisionItemDoc[];
  questionsMap?: Record<string, QuestionDoc>;
  onSelectMock: (test: MockTestDoc) => void;
  onSelectSyllabusTopic: (subject: SubjectKey, title: string) => void;
  onOpenRevisionVault: () => void;
}

export function GlobalSearchModal({
  open,
  onClose,
  tests,
  revisionItems,
  questionsMap,
  onSelectMock,
  onSelectSyllabusTopic,
  onOpenRevisionVault,
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 40);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const matches = useMemo(
    () =>
      searchGlobalStudyItems({
        query,
        tests,
        revisionItems,
        questionsMap,
        limitPerKind: 6,
      }),
    [query, tests, revisionItems, questionsMap]
  );

  if (!open) return null;

  const handleSelect = (match: GlobalSearchMatch) => {
    onClose();
    if (match.kind === 'mock') {
      onSelectMock(match.test);
    } else if (match.kind === 'syllabus') {
      onSelectSyllabusTopic(match.subject, match.title);
    } else {
      onOpenRevisionVault();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 p-4 pt-16 sm:pt-24 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Global Study Search"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search mocks, micro-syllabus chapters, or mistake vault..."
            aria-label="Search mocks, syllabus chapters, and mistakes"
            className="w-full bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close global search"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3 space-y-1.5">
          {matches.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              No matching mock papers, micro-syllabus topics, or saved mistakes found.
            </div>
          ) : (
            matches.map((match) => (
              <button
                key={match.id}
                type="button"
                onClick={() => handleSelect(match)}
                className="w-full flex items-start gap-3 rounded-lg border border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 px-3 py-2.5 text-left transition-colors"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                  {match.kind === 'mock' ? (
                    <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  ) : match.kind === 'syllabus' ? (
                    <BookOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <BookmarkCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {match.title}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {match.subtitle}
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-slate-200/70 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  {match.kind === 'mock' ? 'Launch Mock' : match.kind === 'syllabus' ? 'Filter Topic' : 'Open Vault'}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
