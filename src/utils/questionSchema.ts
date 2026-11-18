import type {
  DifficultyLevel,
  QuestionDoc,
  QuestionInput,
  QuestionMetadata,
  QuestionSchemaV2,
  SubjectKey,
} from '../types/exam';

const SUBJECT_DISPLAY_MAP: Record<SubjectKey, string> = {
  quant: 'Mathematics',
  reasoning: 'General Intelligence & Reasoning',
  english: 'English Comprehension',
  ga: 'General Awareness',
};

const SHIFTS = ['Shift-1', 'Shift-2', 'Shift-3'];
const YEARS = ['2024', '2023', '2022', '2021'];

function clampText(val: unknown, max: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, max);
}

export function normalizeSubjectValue(raw: unknown): SubjectKey | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (
    v === 'quant' ||
    v === 'math' ||
    v === 'maths' ||
    v === 'mathematics' ||
    v === 'quantitative aptitude' ||
    v === 'arithmetic'
  ) {
    return 'quant';
  }
  if (
    v === 'reasoning' ||
    v === 'gi' ||
    v === 'general intelligence' ||
    v === 'general intelligence & reasoning'
  ) {
    return 'reasoning';
  }
  if (
    v === 'english' ||
    v === 'eng' ||
    v === 'english comprehension' ||
    v === 'english language'
  ) {
    return 'english';
  }
  if (
    v === 'ga' ||
    v === 'gk' ||
    v === 'gs' ||
    v === 'general awareness' ||
    v === 'general studies' ||
    v === 'general knowledge'
  ) {
    return 'ga';
  }
  return null;
}

export function normalizeMetadataObject(rawMeta: unknown): QuestionMetadata | undefined {
  if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) return undefined;
  const obj = rawMeta as Record<string, unknown>;
  const exam = clampText(obj.exam, 40);
  const year = clampText(obj.year, 16);
  const tier = clampText(obj.tier, 24);
  const shift = clampText(obj.shift, 24);
  if (!exam && !year && !tier && !shift) return undefined;
  return {
    exam: exam || 'SSC CGL',
    year: year || '2023',
    tier: tier || 'Tier-1',
    shift: shift || 'Shift-1',
  };
}

export function deriveMetadataFromSeedOrTag(
  yearTag?: string,
  idHint?: string
): QuestionMetadata {
  const clean = (yearTag ?? '').trim();
  // Try parsing structured string like "SSC CGL 2023 Tier-1 | Shift-2"
  const pipeParts = clean.split('|').map((s) => s.trim());
  const left = pipeParts[0] ?? '';
  const right = pipeParts[1] ?? '';

  const yearMatch = clean.match(/\b(20\d{2})\b/);
  const tierMatch = clean.match(/tier[\s\-]*(i{1,2}|1|2)/i);
  const shiftMatch = (right || clean).match(/(?:shift[\s\-]*|\bs)(\d+)\b/i);

  let hash = 0;
  const seed = idHint || clean || 'ssc_cgl';
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  let tier = 'Tier-1';
  if (tierMatch) {
    const rawTier = tierMatch[1].toUpperCase();
    tier = rawTier === 'II' || rawTier === '2' ? 'Tier-2' : 'Tier-1';
  }

  let exam = 'SSC CGL';
  if (left) {
    const stripped = left
      .replace(/\b20\d{2}\b/g, '')
      .replace(/tier[\s\-]*(i{1,2}|1|2)/gi, '')
      .trim();
    if (stripped.length >= 3 && stripped.length <= 24) {
      exam = stripped;
    }
  }

  return {
    exam,
    year: yearMatch ? yearMatch[1] : YEARS[hash % YEARS.length],
    tier,
    shift: shiftMatch ? `Shift-${shiftMatch[1]}` : SHIFTS[hash % SHIFTS.length],
  };
}

export function formatMetadataBadge(
  q: Pick<QuestionDoc, 'metadata' | 'yearTag' | 'id' | 'source'>
): string {
  const meta =
    q.metadata && (q.metadata.exam || q.metadata.year || q.metadata.tier || q.metadata.shift)
      ? q.metadata
      : deriveMetadataFromSeedOrTag(q.yearTag, q.id);

  const head = [meta.exam, meta.year, meta.tier].filter(Boolean).join(' ');
  const full = meta.shift ? `${head} | ${meta.shift}` : head;
  return `[${full}]`;
}

export function formatYearTagFromMetadata(meta: QuestionMetadata): string {
  const head = [meta.exam, meta.year, meta.tier].filter(Boolean).join(' ');
  const str = meta.shift ? `${head} | ${meta.shift}` : head;
  return str.slice(0, 40);
}

export function normalizeQuestionDoc(
  raw: Record<string, unknown>,
  fallbackId: string
): QuestionDoc | null {
  const subject = normalizeSubjectValue(raw.subject);
  if (!subject) return null;

  const questionEn = clampText(raw.questionEn ?? raw.question_en, 2000);
  const questionHi = clampText(raw.questionHi ?? raw.question_hi, 2000);
  if (!questionEn && !questionHi) return null;

  const rawOptionsEn = raw.optionsEn ?? raw.options_en;
  const rawOptionsHi = raw.optionsHi ?? raw.options_hi;

  let optionsEn: string[] = [];
  if (Array.isArray(rawOptionsEn)) {
    optionsEn = rawOptionsEn.map((o) => clampText(o, 500));
  }
  let optionsHi: string[] | undefined;
  if (Array.isArray(rawOptionsHi) && rawOptionsHi.length === 4) {
    const mapped = rawOptionsHi.map((o) => clampText(o, 500));
    if (mapped.every((o) => o.length > 0)) {
      optionsHi = mapped;
    }
  }

  if (optionsEn.length !== 4 || optionsEn.some((o) => !o)) {
    if (optionsHi && optionsHi.length === 4) {
      optionsEn = [...optionsHi];
    } else {
      return null;
    }
  }

  const rawCorrect = raw.correctIndex ?? raw.correct_answer_index;
  const parsedIdx = typeof rawCorrect === 'number' ? rawCorrect : Number(rawCorrect);
  const correctIndex: 0 | 1 | 2 | 3 =
    Number.isInteger(parsedIdx) && parsedIdx >= 0 && parsedIdx <= 3
      ? (parsedIdx as 0 | 1 | 2 | 3)
      : 0;

  const diffRaw = String(raw.difficulty ?? 'medium').toLowerCase();
  const difficulty: DifficultyLevel =
    diffRaw === 'easy' || diffRaw === 'hard' ? diffRaw : 'medium';

  const id = clampText(raw.question_id ?? raw.id ?? fallbackId, 128) || fallbackId;
  const yearTag = clampText(raw.yearTag, 40);
  const explicitMeta = normalizeMetadataObject(raw.metadata);
  const metadata = explicitMeta ?? deriveMetadataFromSeedOrTag(yearTag, id);
  const explanationEn = clampText(raw.explanationEn ?? raw.explanation_en, 3000);
  const explanationHi = clampText(raw.explanationHi ?? raw.explanation_hi, 3000);
  const shortTrick = clampText(raw.shortTrick ?? raw.short_trick, 1500);

  return {
    id,
    subject,
    topic: clampText(raw.topic, 80) || 'General',
    difficulty,
    yearTag: yearTag || formatYearTagFromMetadata(metadata),
    metadata,
    source: clampText(raw.source, 64) || `${metadata.exam} ${metadata.year}`,
    questionEn: questionEn || questionHi,
    ...(questionHi ? { questionHi } : {}),
    optionsEn: optionsEn as [string, string, string, string],
    ...(optionsHi ? { optionsHi: optionsHi as [string, string, string, string] } : {}),
    correctIndex,
    ...(explanationEn ? { explanationEn } : {}),
    ...(explanationHi ? { explanationHi } : {}),
    ...(shortTrick ? { shortTrick } : {}),
    createdBy: clampText(raw.createdBy, 128) || 'system',
    ...(raw.createdAt !== undefined ? { createdAt: raw.createdAt } : {}),
    ...(raw.updatedAt !== undefined ? { updatedAt: raw.updatedAt } : {}),
  };
}

export function normalizeQuestionInputFromV2OrLegacy(
  raw: Record<string, unknown>
): { item?: QuestionInput; error?: string } {
  const subject = normalizeSubjectValue(raw.subject);
  if (!subject) {
    return {
      error: `Invalid subject "${String(raw.subject ?? '')}". Use Mathematics/quant, Reasoning/reasoning, English/english, or GS/ga.`,
    };
  }

  const questionEn = clampText(raw.questionEn ?? raw.question_en, 2000);
  const questionHi = clampText(raw.questionHi ?? raw.question_hi, 2000);
  if (!questionEn && !questionHi) {
    return { error: 'question_en (or questionEn) is required.' };
  }

  let optionsEn: string[] = [];
  const rawOptionsEn = raw.optionsEn ?? raw.options_en;
  if (Array.isArray(rawOptionsEn)) {
    optionsEn = rawOptionsEn.map((o) => clampText(o, 500));
  } else if (raw.optionA || raw.optA) {
    optionsEn = [
      clampText(raw.optionA ?? raw.optA, 500),
      clampText(raw.optionB ?? raw.optB, 500),
      clampText(raw.optionC ?? raw.optC, 500),
      clampText(raw.optionD ?? raw.optD, 500),
    ];
  }

  let optionsHi: [string, string, string, string] | undefined;
  const rawOptionsHi = raw.optionsHi ?? raw.options_hi;
  if (Array.isArray(rawOptionsHi) && rawOptionsHi.length === 4) {
    const mapped = rawOptionsHi.map((o) => clampText(o, 500));
    if (mapped.every((o) => o.length > 0)) {
      optionsHi = mapped as [string, string, string, string];
    }
  } else if (raw.optionAHi || raw.optAHi) {
    const mapped = [
      clampText(raw.optionAHi ?? raw.optAHi, 500),
      clampText(raw.optionBHi ?? raw.optBHi, 500),
      clampText(raw.optionCHi ?? raw.optCHi, 500),
      clampText(raw.optionDHi ?? raw.optDHi, 500),
    ];
    if (mapped.every((o) => o.length > 0)) {
      optionsHi = mapped as [string, string, string, string];
    }
  }

  if (optionsEn.length !== 4 || optionsEn.some((o) => o.length === 0)) {
    return { error: 'Exactly 4 non-empty English options (options_en / optionsEn) are required.' };
  }

  const rawAns = raw.correctIndex ?? raw.correct_answer_index ?? raw.answer;
  let correctIndex: 0 | 1 | 2 | 3 | null = null;
  if (typeof rawAns === 'number' && Number.isInteger(rawAns) && rawAns >= 0 && rawAns <= 3) {
    correctIndex = rawAns as 0 | 1 | 2 | 3;
  } else {
    const s = String(rawAns ?? '').trim().toUpperCase();
    if (s === '0' || s === 'A') correctIndex = 0;
    else if (s === '1' || s === 'B') correctIndex = 1;
    else if (s === '2' || s === 'C') correctIndex = 2;
    else if (s === '3' || s === 'D') correctIndex = 3;
  }
  if (correctIndex === null) {
    return { error: 'correct_answer_index (or correctIndex) must be 0..3 or A..D.' };
  }

  const diffRaw = String(raw.difficulty ?? 'medium').trim().toLowerCase();
  const difficulty: DifficultyLevel =
    diffRaw === 'easy' || diffRaw === 'hard' ? diffRaw : 'medium';

  const metadata = normalizeMetadataObject(raw.metadata) ??
    (typeof raw.examShift === 'string' && raw.examShift.trim()
      ? deriveMetadataFromSeedOrTag(raw.examShift.trim())
      : undefined);
  const explicitYearTag = clampText(raw.yearTag ?? raw.examShift, 40);
  const yearTag =
    explicitYearTag || (metadata ? formatYearTagFromMetadata(metadata) : undefined);

  const explanationEn = clampText(raw.explanationEn ?? raw.explanation_en, 3000);
  const explanationHi = clampText(raw.explanationHi ?? raw.explanation_hi, 3000);
  const shortTrick = clampText(raw.shortTrick ?? raw.short_trick, 1500);

  const item: QuestionInput = {
    subject,
    topic: clampText(raw.topic, 80) || 'General',
    difficulty,
    source: clampText(raw.source, 64) || (metadata ? `${metadata.exam} ${metadata.year}` : 'Bulk PYQ Upload'),
    questionEn: questionEn || questionHi,
    optionsEn: optionsEn as [string, string, string, string],
    correctIndex,
    ...(yearTag ? { yearTag } : {}),
    ...(metadata ? { metadata } : {}),
    ...(questionHi ? { questionHi } : {}),
    ...(optionsHi ? { optionsHi } : {}),
    ...(explanationEn ? { explanationEn } : {}),
    ...(explanationHi ? { explanationHi } : {}),
    ...(shortTrick ? { shortTrick } : {}),
  };

  return { item };
}

export function toQuestionSchemaV2(q: QuestionDoc): QuestionSchemaV2 {
  const metadata = q.metadata ?? deriveMetadataFromSeedOrTag(q.yearTag, q.id);
  return {
    question_id: q.id,
    subject: SUBJECT_DISPLAY_MAP[q.subject] ?? q.subject,
    topic: q.topic,
    question_hi: q.questionHi ?? q.questionEn,
    question_en: q.questionEn,
    options_hi: q.optionsHi ?? q.optionsEn,
    options_en: q.optionsEn,
    correct_answer_index: q.correctIndex,
    metadata,
    explanation_hi: q.explanationHi ?? q.explanationEn ?? '',
    explanation_en: q.explanationEn ?? '',
    short_trick: q.shortTrick ?? '',
  };
}
