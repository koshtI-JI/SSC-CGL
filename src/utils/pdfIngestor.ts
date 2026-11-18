import type { DifficultyLevel, QuestionInput, SubjectKey } from '../types/exam';
import { MICRO_SYLLABUS_CHAPTERS } from './dreamPostCatalog';
import { deriveMetadataFromSeedOrTag, formatYearTagFromMetadata } from './questionSchema';

export const STRICT_INGEST_SUBJECT_NAMES = [
  'Quantitative Aptitude',
  'General Intelligence and Reasoning',
  'English Comprehension',
  'General Awareness',
] as const;

export type StrictIngestSubjectName = (typeof STRICT_INGEST_SUBJECT_NAMES)[number];

export const STRICT_SUBJECT_TO_KEY: Record<StrictIngestSubjectName, SubjectKey> = {
  'Quantitative Aptitude': 'quant',
  'General Intelligence and Reasoning': 'reasoning',
  'English Comprehension': 'english',
  'General Awareness': 'ga',
};

export const KEY_TO_STRICT_SUBJECT: Record<SubjectKey, StrictIngestSubjectName> = {
  quant: 'Quantitative Aptitude',
  reasoning: 'General Intelligence and Reasoning',
  english: 'English Comprehension',
  ga: 'General Awareness',
};

export interface PdfPageContent {
  pageNumber: number;
  text: string;
  imageBase64?: string;
  mimeType?: 'image/jpeg';
}

export interface PdfPageChunk {
  chunkIndex: number;
  startPage: number;
  endPage: number;
  pageRangeLabel: string;
  pages: PdfPageContent[];
}

export interface IngestedQuestionDraft extends QuestionInput {
  clientKey: string;
  pageRangeLabel: string;
  strictSubject: StrictIngestSubjectName;
  examShift: string;
  autoTaggedFrom?: string;
}

export interface ParsePdfQuestionsResult {
  items: IngestedQuestionDraft[];
  skippedCount: number;
  errors: Array<{ row: number; message: string }>;
}

export const PDF_INGEST_PAGES_PER_CHUNK = 5;

export function parseStrictIngestSubject(
  rawSubject: unknown
): { ok: true; strictName: StrictIngestSubjectName; subjectKey: SubjectKey } | { ok: false; error: string } {
  const val = typeof rawSubject === 'string' ? rawSubject.trim() : '';
  if ((STRICT_INGEST_SUBJECT_NAMES as readonly string[]).includes(val)) {
    const strictName = val as StrictIngestSubjectName;
    return {
      ok: true,
      strictName,
      subjectKey: STRICT_SUBJECT_TO_KEY[strictName],
    };
  }
  return {
    ok: false,
    error: `Invalid subject "${String(rawSubject ?? '')}". Must strictly be one of: ${STRICT_INGEST_SUBJECT_NAMES.map((s) => `"${s}"`).join(', ')}.`,
  };
}

interface TopicRule {
  topic: string;
  patterns: RegExp[];
}

const SUBJECT_TOPIC_RULES: Record<SubjectKey, TopicRule[]> = {
  quant: [
    {
      topic: 'Trigonometry',
      patterns: [/\b(sin|cos|tan|cot|sec|cosec|trigonometr|radian|angle of elevation|angle of depression)\b/i],
    },
    {
      topic: 'Geometry',
      patterns: [/\b(triangle|circle|chord|tangent|secant|quadrilateral|parallelogram|rhombus|trapezium|cyclic|congruent|similar|incentre|circumcentre|orthocentre|centroid|bisector|polygon|radius|diameter)\b/i],
    },
    {
      topic: 'Mensuration',
      patterns: [/\b(mensuration|surface area|curved surface|total surface|volume|cylinder|sphere|hemisphere|cone|cube|cuboid|prism|pyramid|frustum|perimeter)\b/i],
    },
    {
      topic: 'Algebra',
      patterns: [/\b(algebra|polynomial|quadratic|cubic|surds|indices)\b/i, /\bx\^2|1\/x|a\^3\s*[+-]\s*b\^3|\(a\s*[+-]\s*b\)/i],
    },
    {
      topic: 'Data Interpretation',
      patterns: [/\b(data interpretation|bar graph|pie chart|histogram|line graph|tabulation|following table)\b/i],
    },
    {
      topic: 'Time, Speed & Distance',
      patterns: [/\b(speed|km\/h|m\/s|train|boat|downstream|upstream|pole in \d+|platform|race|relative speed|time,\s*speed)\b/i],
    },
    {
      topic: 'Time & Work',
      patterns: [/\b(time & work|time and work|pipes?|cistern|together complete|days? to finish|efficiency of|wages)\b/i],
    },
    {
      topic: 'SI & CI',
      patterns: [/\b(simple interest|compound interest|si & ci|si and ci|per annum|compounded|principal|installment)\b/i],
    },
    {
      topic: 'Profit & Loss',
      patterns: [/\b(profit|loss|cost price|selling price|marked price|discount|successive discount|dishonest)\b/i],
    },
    {
      topic: 'Ratio & Proportion',
      patterns: [/\b(ratio|proportion|mean proportional|third proportional|fourth proportional|partnership)\b/i],
    },
    {
      topic: 'Average & Mixture',
      patterns: [/\b(average|mean age|alligation|mixture|milk and water)\b/i],
    },
    {
      topic: 'Number System',
      patterns: [/\b(number system|divisible|divisibility|hcf|lcm|remainder|unit digit|prime number|coprime|factor)\b/i],
    },
    {
      topic: 'Percentage',
      patterns: [/\b(percentage|percent)\b/i, /\d+\s*%/],
    },
  ],
  reasoning: [
    {
      topic: 'Dictionary Order',
      patterns: [/\b(dictionary order|english dictionary|alphabetical order|word arrangement)\b/i],
    },
    {
      topic: 'Syllogism',
      patterns: [/\b(syllogism|statements?:\s*all|some .* are|conclusion\s*i)\b/i],
    },
    {
      topic: 'Coding-Decoding',
      patterns: [/\b(coding[-\s]?decoding|certain code language|coded as|written as)\b/i],
    },
    {
      topic: 'Blood Relations',
      patterns: [/\b(blood relation|family tree|mother[- ]in[- ]law|brother of|sister of|pointing to a)\b/i],
    },
    {
      topic: 'Direction Sense',
      patterns: [/\b(direction sense|turns right|turns left|facing north|facing south|facing east|facing west|km towards)\b/i],
    },
    {
      topic: 'Number & Letter Series',
      patterns: [/\b(series|missing number|next term|replace the question mark|alphabet series|letter[-\s]?cluster)\b/i],
    },
    {
      topic: 'Analogy',
      patterns: [/\b(analogy|related to .* in the same way|word pair|number pair)\b/i],
    },
    {
      topic: 'Classification (Odd One Out)',
      patterns: [/\b(odd one out|classification|different from the rest|odd letter|odd number)\b/i],
    },
    {
      topic: 'Venn Diagram',
      patterns: [/\b(venn diagram|best represents the relationship)\b/i],
    },
    {
      topic: 'Dice & Mirror',
      patterns: [/\b(dice|cube|opposite face|mirror image|water image)\b/i],
    },
    {
      topic: 'Seating Arrangement & Puzzles',
      patterns: [/\b(seating arrangement|circular table|sitting around|puzzle|ranking|taller than)\b/i],
    },
    {
      topic: 'Mathematical Operations',
      patterns: [/\b(mathematical operation|sign interchange|interchanging the two signs|bodmas|equation correct|calendar|clock)\b/i],
    },
    {
      topic: 'Non-Verbal & Paper Folding',
      patterns: [/\b(paper folding|embedded figure|counting figure|number of triangles|non-verbal|figure series)\b/i],
    },
  ],
  english: [
    {
      topic: 'Active & Passive Voice',
      patterns: [/\b(active|passive voice|voice change|passive form|active form)\b/i],
    },
    {
      topic: 'Direct & Indirect Narration',
      patterns: [/\b(narration|direct speech|indirect speech|reported speech)\b/i],
    },
    {
      topic: 'Idioms & Phrases',
      patterns: [/\b(idiom|proverb|meaning of the given idiom)\b/i],
    },
    {
      topic: 'One-Word Substitution',
      patterns: [/\b(one[-\s]?word substitution|one word for the group of words|group of words given)\b/i],
    },
    {
      topic: 'Synonyms & Antonyms',
      patterns: [/\b(synonym|antonym|nearest in meaning|opposite in meaning|most appropriate antonym|most appropriate synonym)\b/i],
    },
    {
      topic: 'Spelling Correction',
      patterns: [/\b(spelling|misspelt|incorrectly spelt|correctly spelt|spelt word)\b/i],
    },
    {
      topic: 'Para Jumbles (PQRS)',
      patterns: [/\b(para jumble|pqrs|jumbled|correct order to form a meaningful|rearrange)\b/i],
    },
    {
      topic: 'Cloze Test & RC',
      patterns: [/\b(cloze|comprehension|reading passage|blank no\.)\b/i],
    },
    {
      topic: 'Sentence Improvement',
      patterns: [/\b(sentence improvement|substitute the underlined segment|no substitution required|bracketed part)\b/i],
    },
    {
      topic: 'Error Spotting',
      patterns: [/\b(error spotting|grammatical error|contains a grammatical error|spot the error)\b/i],
    },
    {
      topic: 'Fill in the Blanks',
      patterns: [/\b(fill in the blank|most appropriate word to fill in|double filler)\b/i],
    },
  ],
  ga: [
    {
      topic: 'Sports',
      patterns: [/\b(sport|sports|badminton|cricket|olympic|hockey|football|tennis|chess|athletic|trophy|medal|cup|court|stadium|asian games|commonwealth)\b/i],
    },
    {
      topic: 'History',
      patterns: [/\b(history|maurya|gupta|mughal|indus valley|harappan|vedic|delhi sultanate|gandhi|revolt of 1857|congress|dynasty|emperor|ancient|medieval)\b/i],
    },
    {
      topic: 'Polity & Constitution',
      patterns: [/\b(polity|constitution|article \d+|fundamental right|fundamental duty|directive principle|parliament|president|governor|lok sabha|rajya sabha|supreme court|amendment|panchayat)\b/i],
    },
    {
      topic: 'Geography',
      patterns: [/\b(geography|river|tributary|monsoon|mountain|himalaya|plateau|pass|soil|biosphere|national park|latitude|planet|ocean|climate)\b/i],
    },
    {
      topic: 'Economy',
      patterns: [/\b(econom|rbi|repo rate|fiscal|gdp|gnp|inflation|monetary policy|five[- ]year plan|budget|gst|balance of payments|census)\b/i],
    },
    {
      topic: 'Physics',
      patterns: [/\b(physics|si unit|newton|ohm|ampere|optics|refraction|magnetic|kinetic energy|velocity|acceleration|watt|joule|frequency)\b/i],
    },
    {
      topic: 'Chemistry',
      patterns: [/\b(chemistry|periodic table|atomic number|acid|base|ph value|chemical formula|alloy|isotope|noble gas|valency|alkali)\b/i],
    },
    {
      topic: 'Biology',
      patterns: [/\b(biology|vitamin|deficiency|cell|mitochondria|photosynthesis|blood group|chromosome|enzyme|hormone|disease|bacteria|virus|kingdom)\b/i],
    },
    {
      topic: 'Static GK & Awards',
      patterns: [/\b(static gk|classical dance|folk dance|festival|bharat ratna|padma|nobel|grammy|autobiography|authored by|gharana|musical instrument|unesco|current affairs)\b/i],
    },
  ],
};

const SUBJECT_SPECIFIC_ALLOWED_EXTRA_TOPICS: Record<SubjectKey, string[]> = {
  quant: ['Simplification', 'Surds & Indices', 'Coordinate Geometry', 'Statistics & Probability'],
  reasoning: ['Dictionary Order', 'Calendar & Clock', 'Statement & Assumptions'],
  english: ['Vocabulary', 'Parts of Speech', 'Prepositions', 'Idioms & Phrases'],
  ga: ['Sports', 'Current Affairs', 'Art & Culture', 'Books & Authors', 'Environment'],
};

const DEFAULT_FALLBACK_TOPIC: Record<SubjectKey, string> = {
  quant: 'Quantitative Aptitude',
  reasoning: 'General Reasoning',
  english: 'English Grammar & Comprehension',
  ga: 'Static GK & General Awareness',
};

function topicMatchesSubjectDomain(topicClean: string, targetSubject: SubjectKey): boolean {
  if (!topicClean || topicClean === 'general' || topicClean === 'misc' || topicClean === 'miscellaneous') {
    return false;
  }

  // Reject immediately if rawTopic clearly belongs ONLY to another subject
  const otherSubjects = (['quant', 'reasoning', 'english', 'ga'] as SubjectKey[]).filter(
    (s) => s !== targetSubject
  );
  const matchesTargetChapter = MICRO_SYLLABUS_CHAPTERS.some(
    (ch) =>
      ch.subject === targetSubject &&
      (ch.title.toLowerCase() === topicClean ||
        ch.aliases.some((al) => topicClean.includes(al) || al.includes(topicClean)))
  );
  const matchesTargetExtra = SUBJECT_SPECIFIC_ALLOWED_EXTRA_TOPICS[targetSubject].some(
    (t) => t.toLowerCase() === topicClean || topicClean.includes(t.toLowerCase())
  );
  const matchesTargetRule = SUBJECT_TOPIC_RULES[targetSubject].some((rule) =>
    rule.patterns.some((re) => re.test(topicClean))
  );

  if (matchesTargetChapter || matchesTargetExtra || matchesTargetRule) {
    return true;
  }

  const belongsToOtherSubject = otherSubjects.some((other) =>
    MICRO_SYLLABUS_CHAPTERS.some(
      (ch) =>
        ch.subject === other &&
        (ch.title.toLowerCase() === topicClean ||
          ch.aliases.some((al) => topicClean === al || topicClean.includes(al)))
    ) ||
    SUBJECT_TOPIC_RULES[other].some((rule) => rule.patterns.some((re) => re.test(topicClean)))
  );

  if (belongsToOtherSubject) {
    return false;
  }

  return true;
}

/**
 * Topic Auto-Tagger: checks the canonical `subjectKey` FIRST and strictly maps
 * `topic` within that subject's domain so cross-subject mixing never occurs.
 */
export function autoTagTopicBySubject(params: {
  subjectKey: SubjectKey;
  rawTopic?: unknown;
  questionEn?: string;
  explanationEn?: string;
}): { topic: string; autoCorrected: boolean; previousTopic?: string } {
  const { subjectKey } = params;
  const rawStr = typeof params.rawTopic === 'string' ? params.rawTopic.replace(/\s+/g, ' ').trim() : '';
  const clean = rawStr.toLowerCase();
  const stemText = `${params.questionEn || ''} ${params.explanationEn || ''}`.trim();

  // 1. Check exact / alias match within target subject's rules & micro-syllabus
  if (rawStr && topicMatchesSubjectDomain(clean, subjectKey)) {
    const exactExtra = SUBJECT_SPECIFIC_ALLOWED_EXTRA_TOPICS[subjectKey].find(
      (t) => t.toLowerCase() === clean
    );
    if (exactExtra) {
      return { topic: exactExtra.slice(0, 80), autoCorrected: false };
    }

    const ruleMatchedTopic = SUBJECT_TOPIC_RULES[subjectKey].find(
      (rule) =>
        rule.topic.toLowerCase() === clean || rule.patterns.some((re) => re.test(rawStr))
    );
    if (ruleMatchedTopic) {
      // Preserve clean exact sub-topic name if it's already valid & specific (e.g. "Dictionary Order", "Sports")
      const normalized =
        rawStr.length >= 3 && rawStr.length <= 80 && rawStr.toLowerCase() === ruleMatchedTopic.topic.toLowerCase()
          ? ruleMatchedTopic.topic
          : ruleMatchedTopic.topic;
      return {
        topic: normalized.slice(0, 80),
        autoCorrected: normalized.toLowerCase() !== clean,
        ...(normalized.toLowerCase() !== clean ? { previousTopic: rawStr } : {}),
      };
    }

    const syllabusMatch = MICRO_SYLLABUS_CHAPTERS.find(
      (ch) =>
        ch.subject === subjectKey &&
        (ch.title.toLowerCase() === clean ||
          ch.aliases.some((al) => clean === al || clean.includes(al)))
    );
    if (syllabusMatch) {
      return {
        topic: syllabusMatch.title.slice(0, 80),
        autoCorrected: syllabusMatch.title.toLowerCase() !== clean,
        ...(syllabusMatch.title.toLowerCase() !== clean ? { previousTopic: rawStr } : {}),
      };
    }

    // Valid subject-compatible custom topic name
    return { topic: rawStr.slice(0, 80), autoCorrected: false };
  }

  // 2. Missing, generic, or cross-subject leaked topic -> classify strictly using `subjectKey` rules on stem/explanation
  for (const rule of SUBJECT_TOPIC_RULES[subjectKey]) {
    if (rule.patterns.some((re) => re.test(stemText))) {
      return {
        topic: rule.topic.slice(0, 80),
        autoCorrected: true,
        ...(rawStr ? { previousTopic: rawStr } : {}),
      };
    }
  }

  for (const ch of MICRO_SYLLABUS_CHAPTERS) {
    if (ch.subject !== subjectKey) continue;
    const lowerStem = stemText.toLowerCase();
    if (
      lowerStem.includes(ch.title.toLowerCase()) ||
      ch.aliases.some((al) => al.length >= 4 && lowerStem.includes(al))
    ) {
      return {
        topic: ch.title.slice(0, 80),
        autoCorrected: true,
        ...(rawStr ? { previousTopic: rawStr } : {}),
      };
    }
  }

  const fallbackTopic = DEFAULT_FALLBACK_TOPIC[subjectKey];
  return {
    topic: fallbackTopic,
    autoCorrected: rawStr.toLowerCase() !== fallbackTopic.toLowerCase(),
    ...(rawStr ? { previousTopic: rawStr } : {}),
  };
}

export function chunkPdfPages(
  pages: PdfPageContent[],
  pagesPerChunk: number = PDF_INGEST_PAGES_PER_CHUNK
): PdfPageChunk[] {
  const safeSize = Math.max(1, Math.min(10, Math.floor(pagesPerChunk) || PDF_INGEST_PAGES_PER_CHUNK));
  const chunks: PdfPageChunk[] = [];

  for (let i = 0; i < pages.length; i += safeSize) {
    const slice = pages.slice(i, i + safeSize);
    const hasContent = slice.some(
      (p) => (typeof p.text === 'string' && p.text.trim().length > 0) || Boolean(p.imageBase64)
    );
    if (!hasContent) continue;

    const startPage = slice[0].pageNumber;
    const endPage = slice[slice.length - 1].pageNumber;
    chunks.push({
      chunkIndex: chunks.length,
      startPage,
      endPage,
      pageRangeLabel: startPage === endPage ? `Page ${startPage}` : `Pages ${startPage}–${endPage}`,
      pages: slice,
    });
  }

  return chunks;
}

export function buildPdfExtractionPrompt(params: {
  shiftExamName: string;
  subjectMode: 'auto' | StrictIngestSubjectName;
  pageRangeLabel: string;
}): string {
  const cleanShift = params.shiftExamName.trim() || 'SSC CGL PYQ';
  const subjectInstruction =
    params.subjectMode === 'auto'
      ? `Classify each question's "subject" field STRICTLY as one of these exact 4 strings: ${STRICT_INGEST_SUBJECT_NAMES.map((s) => `"${s}"`).join(', ')}.`
      : `Set "subject" on EVERY extracted question strictly to "${params.subjectMode}".`;

  return [
    'Extract all multiple-choice questions from this document. Output ONLY a valid JSON array of objects. Each object must match this schema: { examShift: string, subject: "Quantitative Aptitude" | "General Intelligence and Reasoning" | "English Comprehension" | "General Awareness", topic: string, questionEn: string, questionHi: string, optionsEn: string[], optionsHi: string[], correctIndex: number (0-3), explanationEn: string, explanationHi: string }. If the document is only in English, translate the \'Hi\' fields accurately to Hindi. Explain the solution step-by-step in the explanation fields.',
    '',
    `Context metadata for this batch (${params.pageRangeLabel}):`,
    `- Default examShift: "${cleanShift}"`,
    `- ${subjectInstruction}`,
    '- Rules:',
    '  1. Preserve exact numbers, mathematical symbols, formulas, and English grammar segments cleanly.',
    '  2. optionsEn and optionsHi MUST each contain exactly 4 options (indexes 0, 1, 2, 3).',
    '  3. Verify the right option carefully and set correctIndex as an integer 0, 1, 2, or 3.',
    '  4. Ensure topic accurately matches the subject domain (e.g. Dictionary Order under General Intelligence and Reasoning; Sports under General Awareness; Algebra under Quantitative Aptitude; Error Spotting under English Comprehension).',
    '  5. If this page range has only cover instructions or zero multiple-choice questions, output an empty JSON array [].',
  ].join('\n');
}

export function stripJsonCodeFences(rawText: string): string {
  let cleaned = String(rawText ?? '').trim();
  if (!cleaned) return '';

  const fencedMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fencedMatch && fencedMatch[1]) {
    cleaned = fencedMatch[1].trim();
  } else {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  return cleaned;
}

function clampString(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') {
    if (typeof val === 'number' || typeof val === 'boolean') {
      return String(val).trim().slice(0, maxLen);
    }
    return '';
  }
  return val.replace(/\r\n/g, '\n').trim().slice(0, maxLen);
}

function parseCorrectIndexStrict(raw: unknown): 0 | 1 | 2 | 3 | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 3) {
    return raw as 0 | 1 | 2 | 3;
  }
  const str = String(raw ?? '').trim().toUpperCase();
  if (str === '0' || str === 'A' || str === '(A)') return 0;
  if (str === '1' || str === 'B' || str === '(B)') return 1;
  if (str === '2' || str === 'C' || str === '(C)') return 2;
  if (str === '3' || str === 'D' || str === '(D)') return 3;
  return null;
}

function parseDifficulty(raw: unknown): DifficultyLevel {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'easy' || s === 'hard') return s;
  return 'medium';
}

export function normalizeParsedPdfArray(
  parsed: unknown,
  context: {
    shiftExamName: string;
    subjectMode: 'auto' | StrictIngestSubjectName;
    pageRangeLabel?: string;
    chunkIndex?: number;
    strictSubjectError?: boolean;
  }
): ParsePdfQuestionsResult {
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown[] }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : null;

  if (!list) {
    throw new Error(
      `Payload for ${context.pageRangeLabel || 'ingest batch'} was valid JSON but not a JSON array of questions.`
    );
  }

  const defaultShift = context.shiftExamName.trim() || 'SSC CGL PYQ';
  const pageLabel = context.pageRangeLabel || 'JSON Batch';
  const chunkTag = context.chunkIndex ?? 0;

  const items: IngestedQuestionDraft[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  let skippedCount = 0;

  list.forEach((rawItem, idx) => {
    const rowNum = idx + 1;
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      skippedCount += 1;
      errors.push({ row: rowNum, message: `Row ${rowNum}: Expected a JSON object.` });
      return;
    }

    const r = rawItem as Record<string, unknown>;

    // Enforce strict 4-subject routing
    let strictSubject: StrictIngestSubjectName;
    let subjectKey: SubjectKey;

    if (context.subjectMode !== 'auto' && r.subject === undefined) {
      strictSubject = context.subjectMode;
      subjectKey = STRICT_SUBJECT_TO_KEY[strictSubject];
    } else {
      const subRes = parseStrictIngestSubject(r.subject);
      if (!subRes.ok) {
        if (context.strictSubjectError !== false) {
          skippedCount += 1;
          errors.push({ row: rowNum, message: `Row ${rowNum}: ${subRes.error}` });
          return;
        }
        if (context.subjectMode !== 'auto') {
          strictSubject = context.subjectMode;
          subjectKey = STRICT_SUBJECT_TO_KEY[strictSubject];
        } else {
          skippedCount += 1;
          errors.push({ row: rowNum, message: `Row ${rowNum}: ${subRes.error}` });
          return;
        }
      } else {
        strictSubject = subRes.strictName;
        subjectKey = subRes.subjectKey;
      }
    }

    const rawQuestionEn = clampString(r.questionEn ?? r.question_en, 2000);
    const rawQuestionHi = clampString(r.questionHi ?? r.question_hi, 2000);

    const rawOptsEn = Array.isArray(r.optionsEn ?? r.options_en)
      ? ((r.optionsEn ?? r.options_en) as unknown[]).map((o) => clampString(o, 500)).slice(0, 4)
      : [];
    const rawOptsHi = Array.isArray(r.optionsHi ?? r.options_hi)
      ? ((r.optionsHi ?? r.options_hi) as unknown[]).map((o) => clampString(o, 500)).slice(0, 4)
      : [];

    const hasValidEnOpts = rawOptsEn.length === 4 && rawOptsEn.every((o) => o.length > 0);
    const hasValidHiOpts = rawOptsHi.length === 4 && rawOptsHi.every((o) => o.length > 0);

    if ((!rawQuestionEn && !rawQuestionHi) || (!hasValidEnOpts && !hasValidHiOpts)) {
      skippedCount += 1;
      errors.push({
        row: rowNum,
        message: `Row ${rowNum}: Question text and exactly 4 non-empty options are required.`,
      });
      return;
    }

    const parsedIdx = parseCorrectIndexStrict(r.correctIndex ?? r.correct_answer_index);
    if (parsedIdx === null) {
      skippedCount += 1;
      errors.push({
        row: rowNum,
        message: `Row ${rowNum}: correctIndex must be an integer 0..3.`,
      });
      return;
    }

    const optionsEn = (hasValidEnOpts ? rawOptsEn : rawOptsHi) as [string, string, string, string];
    const optionsHi = hasValidHiOpts
      ? (rawOptsHi as [string, string, string, string])
      : undefined;

    const questionEn = rawQuestionEn || rawQuestionHi;
    const questionHi = rawQuestionHi || undefined;
    const explanationEn = clampString(r.explanationEn ?? r.explanation_en, 3000);
    const explanationHi = clampString(r.explanationHi ?? r.explanation_hi, 3000);
    const shortTrick = clampString(r.shortTrick ?? r.short_trick, 1500);

    const rowShift = clampString(r.examShift ?? r.yearTag, 40) || defaultShift;
    const metadata = deriveMetadataFromSeedOrTag(rowShift, rowShift);
    const yearTag = rowShift.slice(0, 40) || formatYearTagFromMetadata(metadata);

    const tagged = autoTagTopicBySubject({
      subjectKey,
      rawTopic: r.topic,
      questionEn,
      explanationEn,
    });

    items.push({
      clientKey: `ingest_q_${chunkTag}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
      pageRangeLabel: pageLabel,
      strictSubject,
      examShift: rowShift,
      ...(tagged.autoCorrected && tagged.previousTopic
        ? { autoTaggedFrom: tagged.previousTopic }
        : {}),
      subject: subjectKey,
      topic: tagged.topic,
      difficulty: parseDifficulty(r.difficulty),
      yearTag,
      metadata,
      source: rowShift.slice(0, 64) || 'PYQ Strict Ingestor',
      questionEn,
      ...(questionHi ? { questionHi } : {}),
      optionsEn,
      ...(optionsHi ? { optionsHi } : {}),
      correctIndex: parsedIdx,
      ...(explanationEn ? { explanationEn } : {}),
      ...(explanationHi ? { explanationHi } : {}),
      ...(shortTrick ? { shortTrick } : {}),
    });
  });

  return { items, skippedCount, errors };
}

export function parseAiPdfQuestionsJson(
  rawText: string,
  context: {
    shiftExamName: string;
    subjectMode: 'auto' | StrictIngestSubjectName;
    pageRangeLabel?: string;
    chunkIndex?: number;
  }
): ParsePdfQuestionsResult {
  const cleaned = stripJsonCodeFences(rawText);
  if (!cleaned) {
    throw new Error(
      `AI returned an empty response for ${context.pageRangeLabel || 'this PDF chunk'}.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        parsed = JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
      } catch {
        throw new Error(
          `AI returned malformed JSON for ${context.pageRangeLabel || 'this PDF chunk'}. Please retry or test a smaller PDF.`
        );
      }
    } else {
      throw new Error(
        `AI returned malformed JSON for ${context.pageRangeLabel || 'this PDF chunk'}. Please retry or verify the PDF content.`
      );
    }
  }

  return normalizeParsedPdfArray(parsed, {
    ...context,
    strictSubjectError: context.subjectMode === 'auto',
  });
}

export function parseStrictIngestJson(
  jsonText: string,
  defaultShiftExamName: string = 'SSC CGL PYQ'
): ParsePdfQuestionsResult {
  const cleaned = stripJsonCodeFences(jsonText);
  if (!cleaned) {
    throw new Error('JSON input is empty. Paste a valid JSON array of questions.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Invalid JSON syntax: ${err instanceof Error ? err.message : 'Unable to parse JSON.'}`
    );
  }

  return normalizeParsedPdfArray(parsed, {
    shiftExamName: defaultShiftExamName,
    subjectMode: 'auto',
    pageRangeLabel: 'JSON Uploader',
    chunkIndex: 0,
    strictSubjectError: true,
  });
}

export function toFirestoreQuestionInputs(drafts: IngestedQuestionDraft[]): QuestionInput[] {
  return drafts.map(
    ({
      clientKey: _clientKey,
      pageRangeLabel: _pageRangeLabel,
      strictSubject: _strictSubject,
      examShift: _examShift,
      autoTaggedFrom: _autoTaggedFrom,
      ...rest
    }) => rest
  );
}
