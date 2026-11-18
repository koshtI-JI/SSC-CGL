import type {
  PhysicalChecklistState,
  QuestionDoc,
  SubjectKey,
  TopicMasteryEntry,
} from '../types/exam';
import type { CalculatedTestOutcome } from './examEngine';

export interface DreamPostSpec {
  id: string;
  label: string;
  ministry: string;
  tier1Cutoff: number; // Out of 200
  isInspector: boolean;
  physicalStandards?: {
    height: string;
    walking: string;
    cycling: string;
  };
}

export const DEFAULT_PHYSICAL_CHECKLIST: PhysicalChecklistState = {
  height: false,
  walking: false,
  cycling: false,
};

export const DREAM_POST_CATALOG: DreamPostSpec[] = [
  {
    id: 'aso_mea',
    label: 'ASO in MEA',
    ministry: 'Ministry of External Affairs',
    tier1Cutoff: 162,
    isInspector: false,
  },
  {
    id: 'aso_css',
    label: 'ASO in CSS',
    ministry: 'Central Secretariat Service',
    tier1Cutoff: 156,
    isInspector: false,
  },
  {
    id: 'inspector_it',
    label: 'Income Tax Inspector',
    ministry: 'CBDT (Department of Revenue)',
    tier1Cutoff: 158,
    isInspector: true,
    physicalStandards: {
      height: 'Height >= 157.5 cm (Male) / 152 cm (Female)',
      walking: 'Walking: 1600m in 15 min (Male) / 1 km in 20 min (Female)',
      cycling: 'Cycling: 8 km in 30 min (Male) / 3 km in 25 min (Female)',
    },
  },
  {
    id: 'inspector_gst',
    label: 'GST & Central Excise Inspector',
    ministry: 'CBIC (Indirect Taxes)',
    tier1Cutoff: 150,
    isInspector: true,
    physicalStandards: {
      height: 'Height >= 157.5 cm (Male) / 152 cm (Female) · Chest 81 cm',
      walking: 'Walking: 1600m in 15 min (Male) / 1 km in 20 min (Female)',
      cycling: 'Cycling: 8 km in 30 min (Male) / 3 km in 25 min (Female)',
    },
  },
  {
    id: 'inspector_po',
    label: 'Preventive Officer (Inspector)',
    ministry: 'CBIC Customs',
    tier1Cutoff: 152,
    isInspector: true,
    physicalStandards: {
      height: 'Height >= 157.5 cm (Male) / 152 cm (Female) · Chest 81 cm',
      walking: 'Walking: 1600m in 15 min (Male) / 1 km in 20 min (Female)',
      cycling: 'Cycling: 8 km in 30 min (Male) / 3 km in 25 min (Female)',
    },
  },
  {
    id: 'inspector_examiner',
    label: 'Examiner (Inspector)',
    ministry: 'CBIC Customs',
    tier1Cutoff: 155,
    isInspector: true,
    physicalStandards: {
      height: 'Height >= 157.5 cm (Male) / 152 cm (Female)',
      walking: 'Walking: 1600m in 15 min (Male) / 1 km in 20 min (Female)',
      cycling: 'Cycling: 8 km in 30 min (Male) / 3 km in 25 min (Female)',
    },
  },
  {
    id: 'aao',
    label: 'Assistant Audit Officer (AAO)',
    ministry: 'CAG of India',
    tier1Cutoff: 166,
    isInspector: false,
  },
  {
    id: 'si_cbi',
    label: 'Sub-Inspector (CBI)',
    ministry: 'Central Bureau of Investigation',
    tier1Cutoff: 154,
    isInspector: true,
    physicalStandards: {
      height: 'Height >= 165 cm (Male) / 150 cm (Female) · Vision 6/6 & 6/9',
      walking: 'Endurance / Walking readiness verified',
      cycling: 'Field mobility & Cycling stamina verified',
    },
  },
  {
    id: 'div_accountant',
    label: 'Divisional Accountant',
    ministry: 'CAG / State Works',
    tier1Cutoff: 151,
    isInspector: false,
  },
  {
    id: 'tax_assistant',
    label: 'Tax Assistant (CBDT / CBIC)',
    ministry: 'Department of Revenue',
    tier1Cutoff: 142,
    isInspector: false,
  },
];

export function resolveDreamPost(targetPost?: string | null): DreamPostSpec {
  const clean = (targetPost || '').trim().toLowerCase();
  if (!clean) return DREAM_POST_CATALOG[0];

  const exact = DREAM_POST_CATALOG.find(
    (p) => p.label.toLowerCase() === clean || p.id.toLowerCase() === clean
  );
  if (exact) return exact;

  if (clean.includes('mea')) return DREAM_POST_CATALOG[0];
  if (clean.includes('css')) return DREAM_POST_CATALOG[1];
  if (clean.includes('income tax') || clean.includes('it inspector')) return DREAM_POST_CATALOG[2];
  if (clean.includes('gst') || clean.includes('excise')) return DREAM_POST_CATALOG[3];
  if (clean.includes('preventive')) return DREAM_POST_CATALOG[4];
  if (clean.includes('examiner')) return DREAM_POST_CATALOG[5];
  if (clean.includes('aao') || clean.includes('audit officer')) return DREAM_POST_CATALOG[6];
  if (clean.includes('cbi') || clean.includes('sub-inspector')) return DREAM_POST_CATALOG[7];
  if (clean.includes('divisional')) return DREAM_POST_CATALOG[8];
  if (clean.includes('tax assistant')) return DREAM_POST_CATALOG[9];

  const isInspectorGeneric = clean.includes('inspector');
  return {
    id: 'custom',
    label: targetPost!.trim(),
    ministry: 'SSC CGL Target Allocation',
    tier1Cutoff: isInspectorGeneric ? 154 : 150,
    isInspector: isInspectorGeneric,
    ...(isInspectorGeneric
      ? {
          physicalStandards: {
            height: 'Height >= 157.5 cm (Male) / 152 cm (Female)',
            walking: 'Walking: 1600m in 15 min (Male) / 1 km in 20 min (Female)',
            cycling: 'Cycling: 8 km in 30 min (Male) / 3 km in 25 min (Female)',
          },
        }
      : {}),
  };
}

export interface CutoffBenchmarkResult {
  postLabel: string;
  tier1Cutoff: number;
  scaledCutoff: number;
  maxScore: number;
  score: number;
  isAboveCutoff: boolean;
  deltaMarks: number;
  isInspector: boolean;
}

export function computeTargetCutoffBenchmark(
  targetPost: string | undefined | null,
  score: number,
  maxScore: number
): CutoffBenchmarkResult {
  const spec = resolveDreamPost(targetPost);
  const safeMax = Math.max(1, maxScore);
  const scaledCutoff = Math.round((spec.tier1Cutoff / 200) * safeMax * 10) / 10;
  const deltaMarks = Math.round((score - scaledCutoff) * 10) / 10;
  return {
    postLabel: spec.label,
    tier1Cutoff: spec.tier1Cutoff,
    scaledCutoff,
    maxScore: safeMax,
    score,
    isAboveCutoff: score >= scaledCutoff,
    deltaMarks,
    isInspector: spec.isInspector,
  };
}

export interface MicroSyllabusChapter {
  slug: string;
  title: string;
  subject: SubjectKey;
  aliases: string[];
}

export const MICRO_SYLLABUS_CHAPTERS: MicroSyllabusChapter[] = [
  // Quantitative Aptitude
  { slug: 'quant_percentage', title: 'Percentage', subject: 'quant', aliases: ['percentage', 'percent'] },
  { slug: 'quant_profit_loss', title: 'Profit & Loss', subject: 'quant', aliases: ['profit & loss', 'profit and loss', 'discount', 'marked price'] },
  { slug: 'quant_ratio', title: 'Ratio & Proportion', subject: 'quant', aliases: ['ratio', 'proportion', 'partnership'] },
  { slug: 'quant_si_ci', title: 'SI & CI', subject: 'quant', aliases: ['simple interest', 'compound interest', 'si & ci', 'si and ci', 'installment'] },
  { slug: 'quant_time_work', title: 'Time & Work', subject: 'quant', aliases: ['time & work', 'time and work', 'pipe', 'cistern', 'wages'] },
  { slug: 'quant_tsd', title: 'Time, Speed & Distance', subject: 'quant', aliases: ['speed', 'distance', 'train', 'boat', 'stream', 'race'] },
  { slug: 'quant_algebra', title: 'Algebra', subject: 'quant', aliases: ['algebra', 'surds', 'indices', 'polynomial'] },
  { slug: 'quant_geometry', title: 'Geometry', subject: 'quant', aliases: ['geometry', 'triangle', 'circle', 'chord', 'tangent', 'polygon'] },
  { slug: 'quant_trigonometry', title: 'Trigonometry', subject: 'quant', aliases: ['trigonometry', 'height and distance', 'sin', 'cos', 'radian'] },
  { slug: 'quant_mensuration', title: 'Mensuration', subject: 'quant', aliases: ['mensuration', 'area', 'volume', 'cylinder', 'sphere', 'cone', 'prism', 'pyramid'] },
  { slug: 'quant_number_system', title: 'Number System', subject: 'quant', aliases: ['number system', 'divisibility', 'hcf', 'lcm', 'remainder', 'unit digit'] },
  { slug: 'quant_average', title: 'Average & Mixture', subject: 'quant', aliases: ['average', 'mixture', 'alligation'] },
  { slug: 'quant_di', title: 'Data Interpretation', subject: 'quant', aliases: ['data interpretation', 'di', 'bar graph', 'pie chart', 'histogram', 'table'] },

  // General Intelligence & Reasoning
  { slug: 'reasoning_analogy', title: 'Analogy', subject: 'reasoning', aliases: ['analogy', 'similarity'] },
  { slug: 'reasoning_classification', title: 'Classification (Odd One Out)', subject: 'reasoning', aliases: ['classification', 'odd one out'] },
  { slug: 'reasoning_coding', title: 'Coding-Decoding', subject: 'reasoning', aliases: ['coding', 'decoding', 'letter shifting'] },
  { slug: 'reasoning_series', title: 'Number & Letter Series', subject: 'reasoning', aliases: ['series', 'missing number', 'alphabet series'] },
  { slug: 'reasoning_syllogism', title: 'Syllogism', subject: 'reasoning', aliases: ['syllogism', 'statement', 'conclusion'] },
  { slug: 'reasoning_blood', title: 'Blood Relations', subject: 'reasoning', aliases: ['blood relation', 'family tree'] },
  { slug: 'reasoning_direction', title: 'Direction Sense', subject: 'reasoning', aliases: ['direction', 'shadow'] },
  { slug: 'reasoning_venn', title: 'Venn Diagram', subject: 'reasoning', aliases: ['venn', 'logical venn'] },
  { slug: 'reasoning_dice', title: 'Dice & Mirror', subject: 'reasoning', aliases: ['dice', 'cube', 'mirror', 'water image'] },
  { slug: 'reasoning_seating', title: 'Seating Arrangement & Puzzles', subject: 'reasoning', aliases: ['seating', 'puzzle', 'ranking', 'order'] },
  { slug: 'reasoning_math_ops', title: 'Mathematical Operations', subject: 'reasoning', aliases: ['bodmas', 'mathematical operation', 'sign interchange', 'calendar', 'clock'] },
  { slug: 'reasoning_nonverbal', title: 'Non-Verbal & Paper Folding', subject: 'reasoning', aliases: ['paper folding', 'embedded figure', 'counting figure', 'non-verbal'] },

  // English Comprehension
  { slug: 'english_idioms', title: 'Idioms & Phrases', subject: 'english', aliases: ['idiom', 'phrase'] },
  { slug: 'english_ows', title: 'One-Word Substitution', subject: 'english', aliases: ['one-word', 'one word', 'ows'] },
  { slug: 'english_vocab', title: 'Synonyms & Antonyms', subject: 'english', aliases: ['synonym', 'antonym', 'vocabulary'] },
  { slug: 'english_spelling', title: 'Spelling Correction', subject: 'english', aliases: ['spelling', 'misspelt', 'correctly spelt'] },
  { slug: 'english_error', title: 'Error Spotting', subject: 'english', aliases: ['error spotting', 'grammar', 'tense', 'preposition', 'subject verb'] },
  { slug: 'english_improvement', title: 'Sentence Improvement', subject: 'english', aliases: ['sentence improvement', 'phrase replacement'] },
  { slug: 'english_voice', title: 'Active & Passive Voice', subject: 'english', aliases: ['voice', 'active', 'passive'] },
  { slug: 'english_narration', title: 'Direct & Indirect Narration', subject: 'english', aliases: ['narration', 'direct', 'indirect', 'reported speech'] },
  { slug: 'english_pqrs', title: 'Para Jumbles (PQRS)', subject: 'english', aliases: ['para jumble', 'pqrs', 'sentence rearrangement'] },
  { slug: 'english_cloze', title: 'Cloze Test & RC', subject: 'english', aliases: ['cloze', 'comprehension', 'reading', 'passage'] },
  { slug: 'english_fib', title: 'Fill in the Blanks', subject: 'english', aliases: ['fill in the blanks', 'fib', 'double fillers'] },

  // General Awareness
  { slug: 'ga_history', title: 'History', subject: 'ga', aliases: ['history', 'ancient', 'medieval', 'modern history', 'mughal', 'vedic', 'freedom struggle'] },
  { slug: 'ga_polity', title: 'Polity & Constitution', subject: 'ga', aliases: ['polity', 'constitution', 'article', 'parliament', 'fundamental rights', 'amendment'] },
  { slug: 'ga_geography', title: 'Geography', subject: 'ga', aliases: ['geography', 'river', 'monsoon', 'mountain', 'solar', 'national park'] },
  { slug: 'ga_economy', title: 'Economy', subject: 'ga', aliases: ['economy', 'economics', 'rbi', 'fiscal', 'gdp', 'budget', 'five year plan'] },
  { slug: 'ga_physics', title: 'Physics', subject: 'ga', aliases: ['physics', 'optics', 'electricity', 'force', 'si unit'] },
  { slug: 'ga_chemistry', title: 'Chemistry', subject: 'ga', aliases: ['chemistry', 'acid', 'periodic', 'chemical', 'alloy'] },
  { slug: 'ga_biology', title: 'Biology', subject: 'ga', aliases: ['biology', 'vitamin', 'cell', 'disease', 'plant', 'human body'] },
  { slug: 'ga_static_gk', title: 'Static GK & Awards', subject: 'ga', aliases: ['static gk', 'dance', 'festival', 'award', 'current affairs', 'sports', 'books'] },
];

export function normalizeTopicSlug(topic: string, subjectHint?: SubjectKey): string {
  const clean = topic.trim().toLowerCase();
  const matched = MICRO_SYLLABUS_CHAPTERS.find((ch) => {
    if (subjectHint && ch.subject !== subjectHint) return false;
    return (
      ch.title.toLowerCase() === clean ||
      ch.slug === clean ||
      ch.aliases.some((al) => clean.includes(al) || al.includes(clean))
    );
  });
  if (matched) return matched.slug;

  const anySubjectMatch = MICRO_SYLLABUS_CHAPTERS.find(
    (ch) =>
      ch.title.toLowerCase() === clean ||
      ch.slug === clean ||
      ch.aliases.some((al) => clean.includes(al))
  );
  if (anySubjectMatch) return anySubjectMatch.slug;

  const fallback = clean.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return fallback ? `topic_${fallback}` : 'topic_general';
}

export function resolveSyllabusChapter(
  topic: string,
  subjectHint?: SubjectKey
): MicroSyllabusChapter | null {
  const slug = normalizeTopicSlug(topic, subjectHint);
  return MICRO_SYLLABUS_CHAPTERS.find((c) => c.slug === slug) ?? null;
}

export function evaluateTopicMastery(params: {
  topicTag?: string;
  subjectScope: 'full' | SubjectKey;
  questions: QuestionDoc[];
  outcome: CalculatedTestOutcome;
  existingMastery?: Record<string, TopicMasteryEntry>;
  nowMs?: number;
}): {
  updatedMastery: Record<string, TopicMasteryEntry>;
  newlyMasteredTopics: string[];
  changed: boolean;
} {
  const nowMs = params.nowMs ?? Date.now();
  const next: Record<string, TopicMasteryEntry> = { ...(params.existingMastery ?? {}) };
  const newlyMasteredTopics: string[] = [];
  let changed = false;

  const applyChapterUpdate = (
    slug: string,
    title: string,
    subject: SubjectKey,
    accuracy: number
  ) => {
    const prev = next[slug];
    const isNowMastered = accuracy > 80;
    const wasMastered = Boolean(prev?.mastered);
    const updated: TopicMasteryEntry = {
      topic: prev?.topic || title,
      subject,
      bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, Math.round(accuracy * 10) / 10),
      attempts: (prev?.attempts ?? 0) + 1,
      mastered: wasMastered || isNowMastered,
      updatedAtMs: nowMs,
    };
    next[slug] = updated;
    changed = true;
    if (isNowMastered && !wasMastered) {
      newlyMasteredTopics.push(updated.topic);
    }
  };

  // 1. Primary Smart Topic test update (explicit topicTag)
  const cleanTag = (params.topicTag || '').trim();
  if (cleanTag && params.outcome.attemptedCount > 0) {
    const subjectHint =
      params.subjectScope !== 'full'
        ? params.subjectScope
        : params.questions[0]?.subject;
    const matched = resolveSyllabusChapter(cleanTag, subjectHint);
    const slug = matched?.slug ?? normalizeTopicSlug(cleanTag, subjectHint);
    const title = matched?.title ?? cleanTag.slice(0, 60);
    const subject = matched?.subject ?? subjectHint ?? 'quant';
    applyChapterUpdate(slug, title, subject, params.outcome.accuracy);
  }

  // 2. Also track any specific syllabus chapter that appeared with >= 3 attempted questions in this test
  const bySlug = new Map<
    string,
    { title: string; subject: SubjectKey; correct: number; attempted: number }
  >();
  params.questions.forEach((q, idx) => {
    const res = params.outcome.perQuestionResults[idx];
    if (!res || res.selectedIndex < 0 || res.selectedIndex > 3) return;
    const ch = resolveSyllabusChapter(q.topic, q.subject);
    if (!ch) return;
    if (cleanTag && normalizeTopicSlug(cleanTag, ch.subject) === ch.slug) return;
    const bucket = bySlug.get(ch.slug) ?? {
      title: ch.title,
      subject: ch.subject,
      correct: 0,
      attempted: 0,
    };
    bucket.attempted += 1;
    if (res.isCorrect) bucket.correct += 1;
    bySlug.set(ch.slug, bucket);
  });

  for (const [slug, b] of bySlug.entries()) {
    if (b.attempted >= 3) {
      const acc = Math.round((b.correct / b.attempted) * 1000) / 10;
      applyChapterUpdate(slug, b.title, b.subject, acc);
    }
  }

  return { updatedMastery: next, newlyMasteredTopics, changed };
}
