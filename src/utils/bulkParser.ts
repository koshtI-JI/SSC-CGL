import type { QuestionInput } from '../types/exam';
import { normalizeQuestionInputFromV2OrLegacy } from './questionSchema';

export interface ParsedBulkResult {
  valid: QuestionInput[];
  errors: Array<{ row: number; message: string }>;
}

function validateRow(raw: Record<string, unknown>, rowNum: number): { item?: QuestionInput; error?: string } {
  const res = normalizeQuestionInputFromV2OrLegacy(raw);
  if (res.error) {
    return { error: `Row ${rowNum}: ${res.error}` };
  }
  return { item: res.item };
}

export function parseBulkJsonQuestions(jsonText: string): ParsedBulkResult {
  const valid: QuestionInput[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      valid: [],
      errors: [{ row: 0, message: `Invalid JSON syntax: ${err instanceof Error ? err.message : 'Parse error'}` }],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      valid: [],
      errors: [{ row: 0, message: 'JSON root must be an array of question objects.' }],
    };
  }

  parsed.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ row: idx + 1, message: `Row ${idx + 1}: Expected a JSON object.` });
      return;
    }
    const res = validateRow(entry as Record<string, unknown>, idx + 1);
    if (res.item) valid.push(res.item);
    if (res.error) errors.push({ row: idx + 1, message: res.error });
  });

  return { valid, errors };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseBulkCsvQuestions(csvText: string): ParsedBulkResult {
  const valid: QuestionInput[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      valid: [],
      errors: [{ row: 0, message: 'CSV must include a header row and at least one question row.' }],
    };
  }

  const headers = parseCsvLine(lines[0]);
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r]);
    const rowObj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = cols[idx] ?? '';
    });
    const res = validateRow(rowObj, r);
    if (res.item) valid.push(res.item);
    if (res.error) errors.push({ row: r, message: res.error });
  }

  return { valid, errors };
}
