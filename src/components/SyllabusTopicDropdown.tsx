import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, Search, X } from 'lucide-react';
import { SUBJECT_LABELS, type SubjectKey, type TopicMasteryEntry } from '../types/exam';
import type { MicroSyllabusChapter } from '../utils/dreamPostCatalog';
import {
  flattenGroupedSyllabusChapters,
  getGroupedSyllabusChapters,
} from '../utils/syllabusCatalog';

export interface SelectedSyllabusTopic {
  slug: string;
  title: string;
  subject: SubjectKey;
}

interface SyllabusTopicDropdownProps {
  value: SelectedSyllabusTopic;
  onChange: (next: SelectedSyllabusTopic) => void;
  syllabusMastery?: Record<string, TopicMasteryEntry>;
  disabled?: boolean;
}

export const SyllabusTopicDropdown: React.FC<SyllabusTopicDropdownProps> = ({
  value,
  onChange,
  syllabusMastery = {},
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const groups = useMemo(() => getGroupedSyllabusChapters(searchQuery), [searchQuery]);
  const flatOptions = useMemo(() => flattenGroupedSyllabusChapters(groups), [groups]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const id = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const handleSelectChapter = (ch: MicroSyllabusChapter) => {
    onChange({ slug: ch.slug, title: ch.title, subject: ch.subject });
    setOpen(false);
    setSearchQuery('');
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatOptions.length > 0) {
        setActiveIndex((prev) => (prev + 1) % flatOptions.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatOptions.length > 0) {
        setActiveIndex((prev) => (prev - 1 + flatOptions.length) % flatOptions.length);
      }
    } else if (e.key === 'Enter') {
      if (flatOptions.length > 0) {
        e.preventDefault();
        const chosen = flatOptions[Math.min(activeIndex, flatOptions.length - 1)];
        if (chosen) handleSelectChapter(chosen);
      }
    }
  };

  let runningOptionIndex = -1;

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        id="smart-topic-dropdown-trigger"
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="smart-topic-listbox"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 flex min-h-[38px] w-full items-center justify-between gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-left text-xs font-semibold text-slate-900 dark:text-slate-100 hover:border-blue-500 focus:border-blue-600 focus:outline-none disabled:opacity-50 cursor-pointer transition-colors"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300">
            {SUBJECT_LABELS[value.subject].short}
          </span>
          <span className="truncate">{value.title}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id="smart-topic-listbox"
          role="listbox"
          aria-label="Official SSC CGL Tier-1 Syllabus Topics"
          className="absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#161c28] shadow-xl sm:min-w-[340px]"
        >
          <div className="border-b border-slate-200 dark:border-slate-800 p-2.5">
            <div className="relative flex items-center">
              <Search
                className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                id="smart-topic-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Search syllabus (e.g., Algebra, Cloze, Polity)..."
                aria-label="Search SSC CGL syllabus chapters"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#11151d] py-1.5 pl-8 pr-7 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setActiveIndex(0);
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear topic search"
                  className="absolute right-2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {groups.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No syllabus chapter matches &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.subject} className="pb-1">
                  <div className="sticky top-0 z-10 border-y border-slate-100 dark:border-slate-800 bg-slate-50/95 dark:bg-[#111621]/95 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 backdrop-blur-xs">
                    {group.label} ({group.chapters.length})
                  </div>
                  <div className="p-1">
                    {group.chapters.map((ch) => {
                      runningOptionIndex += 1;
                      const currentOptIndex = runningOptionIndex;
                      const isSelected = ch.slug === value.slug || (ch.title === value.title && ch.subject === value.subject);
                      const isActive = currentOptIndex === activeIndex;
                      const isMastered = Boolean(syllabusMastery[ch.slug]?.mastered);

                      return (
                        <button
                          key={ch.slug}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onMouseEnter={() => setActiveIndex(currentOptIndex)}
                          onClick={() => handleSelectChapter(ch)}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-950/50 font-bold text-blue-800 dark:text-blue-200'
                              : isActive
                                ? 'bg-slate-100 dark:bg-slate-800/70 font-medium text-slate-900 dark:text-slate-100'
                                : 'font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                          }`}
                        >
                          <span className="truncate">{ch.title}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {isMastered && (
                              <span title="Mastered (>80%)" className="inline-flex items-center">
                                <CheckCircle2
                                  className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                                  aria-hidden="true"
                                />
                              </span>
                            )}
                            {isSelected && (
                              <Check
                                className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400"
                                aria-hidden="true"
                              />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
