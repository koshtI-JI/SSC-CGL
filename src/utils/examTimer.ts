import type { LanguageMode, QuestionDoc } from '../types/exam';
import type { TranslatedQuestionPayload } from './studyCoach';

export function computeWallClockRemainingSeconds(
  deadlineAtMs: number | undefined | null,
  fallbackSeconds: number,
  nowMs: number = Date.now()
): number {
  if (typeof deadlineAtMs === 'number' && Number.isFinite(deadlineAtMs) && deadlineAtMs > 0) {
    return Math.max(0, Math.ceil((deadlineAtMs - nowMs) / 1000));
  }
  return Math.max(0, Math.floor(fallbackSeconds));
}

export function sanitizeDocIdSegment(raw: string, maxLen: number = 48): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.slice(0, maxLen) || 'id';
}

export function createExamSessionId(nowMs: number = Date.now()): string {
  const timePart = Math.max(0, Math.floor(nowMs)).toString(36);
  const randPart = Math.random().toString(36).slice(2, 8);
  return `sess_${timePart}_${randPart}`;
}

export function resolveDeterministicAttemptId(
  uid: string,
  examSessionId: string | undefined | null,
  fallbackGenerator: () => string
): string {
  const trimmedSess = typeof examSessionId === 'string' ? examSessionId.trim() : '';
  if (!trimmedSess) {
    return fallbackGenerator();
  }
  const safeUid = sanitizeDocIdSegment(uid, 40);
  const safeSess = sanitizeDocIdSegment(trimmedSess, 64);
  return `att_${safeUid}_${safeSess}`.slice(0, 128);
}

export function resolveDeterministicXpLedgerId(
  attemptId: string,
  prefix: string = 'xp'
): string {
  const safePrefix = sanitizeDocIdSegment(prefix, 16);
  const safeAtt = sanitizeDocIdSegment(attemptId, 108);
  return `${safePrefix}_${safeAtt}`.slice(0, 128);
}

export interface BilingualQuestionView {
  primaryStem: string;
  secondaryStem: string;
  primaryOptions: [string, string, string, string];
  secondaryOptions: [string, string, string, string] | null;
  primaryExplanation: string;
  secondaryExplanation: string;
  hindiAvailable: boolean;
  hindiFallbackUsed: boolean;
}

export function resolveBilingualQuestionView(params: {
  question: Pick<
    QuestionDoc,
    'questionEn' | 'questionHi' | 'optionsEn' | 'optionsHi' | 'explanationEn' | 'explanationHi'
  >;
  lang: LanguageMode;
  liveTranslation?: TranslatedQuestionPayload | null;
}): BilingualQuestionView {
  const { question, lang, liveTranslation } = params;
  const stemEn = (question.questionEn || '').trim();
  const stemHi = (question.questionHi || liveTranslation?.questionHi || '').trim();

  const optsEn: [string, string, string, string] = [
    question.optionsEn?.[0] ?? '',
    question.optionsEn?.[1] ?? '',
    question.optionsEn?.[2] ?? '',
    question.optionsEn?.[3] ?? '',
  ];
  const rawOptsHi = question.optionsHi ?? liveTranslation?.optionsHi;
  const hasAllHiOpts = Boolean(
    rawOptsHi && rawOptsHi.length === 4 && rawOptsHi.some((o) => Boolean((o || '').trim()))
  );
  const optsHi: [string, string, string, string] | null = hasAllHiOpts
    ? [
        (rawOptsHi?.[0] || '').trim(),
        (rawOptsHi?.[1] || '').trim(),
        (rawOptsHi?.[2] || '').trim(),
        (rawOptsHi?.[3] || '').trim(),
      ]
    : null;

  const explEn = (question.explanationEn || '').trim();
  const explHi = (question.explanationHi || liveTranslation?.explanationHi || '').trim();
  const hindiAvailable = Boolean(stemHi);

  if (lang === 'hi') {
    if (hindiAvailable) {
      return {
        primaryStem: stemHi,
        secondaryStem: stemEn,
        primaryOptions: [
          optsHi?.[0] || optsEn[0],
          optsHi?.[1] || optsEn[1],
          optsHi?.[2] || optsEn[2],
          optsHi?.[3] || optsEn[3],
        ],
        secondaryOptions: optsEn,
        primaryExplanation: explHi || explEn,
        secondaryExplanation: explHi ? explEn : '',
        hindiAvailable: true,
        hindiFallbackUsed: false,
      };
    }
    return {
      primaryStem: stemEn,
      secondaryStem: '',
      primaryOptions: optsEn,
      secondaryOptions: null,
      primaryExplanation: explEn,
      secondaryExplanation: '',
      hindiAvailable: false,
      hindiFallbackUsed: true,
    };
  }

  return {
    primaryStem: stemEn,
    secondaryStem: stemHi,
    primaryOptions: optsEn,
    secondaryOptions: optsHi,
    primaryExplanation: explEn,
    secondaryExplanation: explHi,
    hindiAvailable,
    hindiFallbackUsed: false,
  };
}
