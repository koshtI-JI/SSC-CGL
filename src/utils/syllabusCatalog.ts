import { SUBJECT_LABELS, type SubjectKey } from '../types/exam';
import { MICRO_SYLLABUS_CHAPTERS, type MicroSyllabusChapter } from './dreamPostCatalog';

export const SYLLABUS_SUBJECT_ORDER: SubjectKey[] = [
  'quant',
  'reasoning',
  'english',
  'ga',
];

export interface SyllabusGroup {
  subject: SubjectKey;
  label: string;
  shortLabel: string;
  chapters: MicroSyllabusChapter[];
}

export function getGroupedSyllabusChapters(searchQuery: string = ''): SyllabusGroup[] {
  const needle = searchQuery.trim().toLowerCase();

  return SYLLABUS_SUBJECT_ORDER.map((subject) => {
    const meta = SUBJECT_LABELS[subject];
    const subjectMatches =
      needle.length > 0 &&
      (meta.en.toLowerCase().includes(needle) ||
        meta.short.toLowerCase().includes(needle) ||
        subject.toLowerCase().includes(needle));

    const chapters = MICRO_SYLLABUS_CHAPTERS.filter((ch) => {
      if (ch.subject !== subject) return false;
      if (!needle || subjectMatches) return true;
      if (ch.title.toLowerCase().includes(needle)) return true;
      if (ch.slug.toLowerCase().includes(needle)) return true;
      return ch.aliases.some((al) => al.toLowerCase().includes(needle));
    });

    return {
      subject,
      label: meta.en,
      shortLabel: meta.short,
      chapters,
    };
  }).filter((group) => group.chapters.length > 0);
}

export function flattenGroupedSyllabusChapters(groups: SyllabusGroup[]): MicroSyllabusChapter[] {
  const flat: MicroSyllabusChapter[] = [];
  for (const g of groups) {
    flat.push(...g.chapters);
  }
  return flat;
}

export function findSyllabusChapterByValue(
  value: string,
  subjectHint?: SubjectKey
): MicroSyllabusChapter | null {
  const clean = value.trim().toLowerCase();
  if (!clean) return null;

  const candidates = subjectHint
    ? MICRO_SYLLABUS_CHAPTERS.filter((ch) => ch.subject === subjectHint)
    : MICRO_SYLLABUS_CHAPTERS;

  const exact = candidates.find(
    (ch) => ch.title.toLowerCase() === clean || ch.slug.toLowerCase() === clean
  );
  if (exact) return exact;

  const aliasExact = candidates.find((ch) =>
    ch.aliases.some((al) => al.toLowerCase() === clean)
  );
  if (aliasExact) return aliasExact;

  return (
    candidates.find(
      (ch) =>
        ch.title.toLowerCase().includes(clean) ||
        ch.aliases.some((al) => al.toLowerCase().includes(clean) || clean.includes(al.toLowerCase()))
    ) ?? null
  );
}
