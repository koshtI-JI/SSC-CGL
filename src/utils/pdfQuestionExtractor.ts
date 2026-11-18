import type { QuestionInput, SubjectKey } from '../types/exam';
import {
  autoTagTopicBySubject,
  KEY_TO_STRICT_SUBJECT,
  parseStrictIngestSubject,
  STRICT_INGEST_SUBJECT_NAMES,
  stripJsonCodeFences,
  type StrictIngestSubjectName,
} from './pdfIngestor';

export interface ExtractedPdfQuestionRow {
  clientKey: string;
  subject: string;
  strictSubject: StrictIngestSubjectName;
  subjectKey: SubjectKey;
  topic: string;
  questionEn: string;
  optionsEn: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
}

export interface ParseExtractedMcqResult {
  rows: ExtractedPdfQuestionRow[];
  skippedCount: number;
}

export const RAW_PDF_TEXT_CHUNK_MAX_CHARS = 12_000;

export function buildRawTextMcqExtractionPrompt(rawText: string): string {
  const cleanText = String(rawText ?? '').trim();
  return [
    'You are an expert SSC CGL question bank parser.',
    'Analyze the following raw text extracted from an exam PDF. Identify every multiple-choice question, its 4 options, and its correct answer.',
    'Return ONLY a valid JSON array matching this exact schema (no markdown fences, no commentary):',
    '[{ "subject": "string", "topic": "string", "questionEn": "string", "optionsEn": ["A", "B", "C", "D"], "correctIndex": number (0-3) }]',
    '',
    'Strict Rules:',
    `1. Set "subject" to the best matching SSC CGL section: ${STRICT_INGEST_SUBJECT_NAMES.map((s) => `"${s}"`).join(', ')}.`,
    '2. Set "topic" to the concise chapter name (e.g., Algebra, Geometry, Syllogism, Coding-Decoding, Synonyms, Error Spotting, Polity, History, Sports).',
    '3. Keep "questionEn" clean without leading "Q.1)" prefixes if avoidable, and ensure "optionsEn" has exactly 4 distinct non-empty strings without "(a)/(b)/(c)/(d)" labels.',
    '4. Set "correctIndex" as an integer 0, 1, 2, or 3 corresponding to the right option in "optionsEn". If an answer key is at the bottom of the text, match it accurately.',
    '5. If there are no valid multiple-choice questions in this text segment, return [].',
    '',
    '--- EXTRACTED PDF TEXT ---',
    cleanText,
  ].join('\n');
}

export function chunkRawPdfText(
  rawText: string,
  maxCharsPerChunk: number = RAW_PDF_TEXT_CHUNK_MAX_CHARS
): string[] {
  const normalized = String(rawText ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const limit = Math.max(1500, Math.floor(maxCharsPerChunk) || RAW_PDF_TEXT_CHUNK_MAX_CHARS);
  if (normalized.length <= limit) return [normalized];

  const blocks = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (trimmed.length > limit) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      for (let i = 0; i < trimmed.length; i += limit) {
        const piece = trimmed.slice(i, i + limit).trim();
        if (piece) chunks.push(piece);
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${trimmed}` : trimmed;
    if (candidate.length > limit) {
      chunks.push(current.trim());
      current = trimmed;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

const SUBJECT_ALIAS_PATTERNS: Array<{ key: SubjectKey; re: RegExp }> = [
  {
    key: 'quant',
    re: /\b(quant|quantitative|math|maths|mathematics|arithmetic|algebra|geometry|trigonometry|mensuration|data interpretation)\b/i,
  },
  {
    key: 'reasoning',
    re: /\b(reasoning|general intelligence|intelligence|gi|analytical|logical|mental ability)\b/i,
  },
  {
    key: 'english',
    re: /\b(english|comprehension|grammar|vocabulary|verbal)\b/i,
  },
  {
    key: 'ga',
    re: /\b(general awareness|general knowledge|general studies|ga|gk|gs|current affairs|history|polity|geography|economy|science|static gk)\b/i,
  },
];

export function resolveExtractorSubject(params: {
  rawSubject: unknown;
  rawTopic?: unknown;
  questionEn?: string;
}): { strictSubject: StrictIngestSubjectName; subjectKey: SubjectKey } {
  const strictRes = parseStrictIngestSubject(params.rawSubject);
  if (strictRes.ok) {
    return { strictSubject: strictRes.strictName, subjectKey: strictRes.subjectKey };
  }

  const subStr = typeof params.rawSubject === 'string' ? params.rawSubject.trim() : '';
  for (const entry of SUBJECT_ALIAS_PATTERNS) {
    if (subStr && entry.re.test(subStr)) {
      return {
        strictSubject: KEY_TO_STRICT_SUBJECT[entry.key],
        subjectKey: entry.key,
      };
    }
  }

  const hint = `${typeof params.rawTopic === 'string' ? params.rawTopic : ''} ${params.questionEn || ''}`.trim();
  for (const entry of SUBJECT_ALIAS_PATTERNS) {
    if (hint && entry.re.test(hint)) {
      return {
        strictSubject: KEY_TO_STRICT_SUBJECT[entry.key],
        subjectKey: entry.key,
      };
    }
  }

  return {
    strictSubject: KEY_TO_STRICT_SUBJECT.ga,
    subjectKey: 'ga',
  };
}

function parseCorrectIndex(raw: unknown): 0 | 1 | 2 | 3 | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 3) {
    return raw as 0 | 1 | 2 | 3;
  }
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === '0' || s === 'A' || s === '(A)') return 0;
  if (s === '1' || s === 'B' || s === '(B)') return 1;
  if (s === '2' || s === 'C' || s === '(C)') return 2;
  if (s === '3' || s === 'D' || s === '(D)') return 3;
  return null;
}

export function parseExtractedMcqJson(
  rawResponseText: string
): ParseExtractedMcqResult {
  const cleaned = stripJsonCodeFences(rawResponseText);
  if (!cleaned) {
    throw new Error('Gemini returned an empty response while parsing the PDF text.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        throw new Error('Gemini returned malformed JSON while extracting MCQs from the PDF.');
      }
    } else {
      throw new Error('Gemini returned non-JSON output while extracting MCQs from the PDF.');
    }
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown[] }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : null;

  if (!list) {
    throw new Error('AI output was valid JSON but not an array of multiple-choice questions.');
  }

  const rows: ExtractedPdfQuestionRow[] = [];
  let skippedCount = 0;

  list.forEach((rawItem, idx) => {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      skippedCount += 1;
      return;
    }
    const item = rawItem as Record<string, unknown>;
    const questionEn =
      typeof item.questionEn === 'string'
        ? item.questionEn.replace(/\r\n/g, '\n').trim().slice(0, 2000)
        : '';

    const rawOptions = Array.isArray(item.optionsEn)
      ? item.optionsEn
          .map((o) => (typeof o === 'string' || typeof o === 'number' ? String(o).trim().slice(0, 500) : ''))
          .slice(0, 4)
      : [];

    if (!questionEn || rawOptions.length !== 4 || rawOptions.some((o) => !o)) {
      skippedCount += 1;
      return;
    }

    const correctIndex = parseCorrectIndex(item.correctIndex);
    if (correctIndex === null) {
      skippedCount += 1;
      return;
    }

    const resolvedSub = resolveExtractorSubject({
      rawSubject: item.subject,
      rawTopic: item.topic,
      questionEn,
    });

    const tagged = autoTagTopicBySubject({
      subjectKey: resolvedSub.subjectKey,
      rawTopic: item.topic,
      questionEn,
    });

    rows.push({
      clientKey: `pdf_ext_${idx}_${Math.random().toString(36).slice(2, 8)}`,
      subject: resolvedSub.strictSubject,
      strictSubject: resolvedSub.strictSubject,
      subjectKey: resolvedSub.subjectKey,
      topic: tagged.topic,
      questionEn,
      optionsEn: rawOptions as [string, string, string, string],
      correctIndex,
    });
  });

  return { rows, skippedCount };
}

export function toExtractedFirestoreQuestions(
  rows: ExtractedPdfQuestionRow[],
  sourceLabel: string = 'PDF Auto-Extractor'
): QuestionInput[] {
  const cleanSource = sourceLabel.trim().slice(0, 64) || 'PDF Auto-Extractor';
  return rows.map((row) => ({
    subject: row.subjectKey,
    topic: row.topic.trim().slice(0, 80) || 'General',
    difficulty: 'medium',
    source: cleanSource,
    questionEn: row.questionEn.trim().slice(0, 2000),
    optionsEn: row.optionsEn.map((o) => o.trim().slice(0, 500)) as [
      string,
      string,
      string,
      string,
    ],
    correctIndex: row.correctIndex,
  }));
}
