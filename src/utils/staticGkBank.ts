import gkBankRaw from '../data/gkBank.json';
import type { DifficultyLevel, QuestionDoc, QuestionInput } from '../types/exam';

export interface StaticGkEntry extends QuestionInput {
  seedId: string;
}

const STATIC_GK_ENTRIES: StaticGkEntry[] = (gkBankRaw as StaticGkEntry[]).map((item) => ({
  seedId: String(item.seedId),
  subject: 'ga',
  topic: String(item.topic || 'Static GK & Awards'),
  difficulty: (['easy', 'medium', 'hard'].includes(item.difficulty)
    ? item.difficulty
    : 'medium') as DifficultyLevel,
  yearTag: item.yearTag || 'SSC CGL PYQ',
  source: item.source || 'Verified Static GK Bank',
  questionEn: String(item.questionEn),
  ...(item.questionHi ? { questionHi: String(item.questionHi) } : {}),
  optionsEn: [...item.optionsEn] as [string, string, string, string],
  ...(item.optionsHi ? { optionsHi: [...item.optionsHi] as [string, string, string, string] } : {}),
  correctIndex: ([0, 1, 2, 3].includes(item.correctIndex) ? item.correctIndex : 0) as 0 | 1 | 2 | 3,
  ...(item.explanationEn ? { explanationEn: String(item.explanationEn) } : {}),
  ...(item.explanationHi ? { explanationHi: String(item.explanationHi) } : {}),
  ...(item.shortTrick ? { shortTrick: String(item.shortTrick) } : {}),
}));

const CHAPTER_ALIASES: Record<string, string[]> = {
  History: [
    'history',
    'ancient',
    'medieval',
    'modern history',
    'mughal',
    'vedic',
    'freedom struggle',
    'indus',
    'battle',
    'satyagraha',
  ],
  'Polity & Constitution': [
    'polity',
    'constitution',
    'article',
    'parliament',
    'fundamental rights',
    'amendment',
    'schedule',
    'writs',
    'supreme court',
  ],
  Geography: [
    'geography',
    'indian geography',
    'river',
    'rivers',
    'monsoon',
    'mountain',
    'solar',
    'national park',
    'lake',
    'kosi',
    'ganga',
  ],
  Economy: [
    'economy',
    'economics',
    'indian economy',
    'rbi',
    'fiscal',
    'gdp',
    'budget',
    'five year plan',
    'five-year plan',
    'gst',
    'lorenz',
  ],
  Physics: ['physics', 'optics', 'electricity', 'force', 'si unit', 'refraction', 'ammeter', 'charge'],
  Chemistry: ['chemistry', 'acid', 'periodic', 'chemical', 'alloy', 'brass', 'plaster', 'gypsum'],
  Biology: ['biology', 'vitamin', 'cell', 'disease', 'plant', 'human body', 'blood group', 'universal donor', 'mitochondria'],
  'Static GK & Awards': [
    'static gk',
    'art & culture',
    'art and culture',
    'dance',
    'kathak',
    'birju maharaj',
    'festival',
    'award',
    'books',
    'sports',
    'current affairs',
  ],
};

function shuffleInPlace<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Returns true if the requested subject or topic belongs to General Awareness (GK/GS/History/Polity/etc.),
 * ensuring zero Groq API calls are made for factual GK questions.
 * Explicitly returns false when subject is set to 'quant', 'reasoning', or 'english'.
 */
export function isGeneralAwarenessSubjectOrTopic(subject?: string, topic?: string): boolean {
  const subClean = String(subject || '').trim().toLowerCase();
  if (
    subClean === 'ga' ||
    subClean === 'gk' ||
    subClean === 'gs' ||
    subClean === 'general awareness' ||
    subClean === 'general knowledge' ||
    subClean === 'general studies'
  ) {
    return true;
  }
  if (subClean === 'quant' || subClean === 'reasoning' || subClean === 'english') {
    return false;
  }

  const topicClean = String(topic || '').trim().toLowerCase();
  if (!topicClean) return false;
  if (
    topicClean === 'ga' ||
    topicClean === 'gk' ||
    topicClean === 'gs' ||
    topicClean.includes('general awareness') ||
    topicClean.includes('general knowledge') ||
    topicClean.includes('general science')
  ) {
    return true;
  }

  return Object.entries(CHAPTER_ALIASES).some(([canonicalTopic, aliases]) => {
    const canonicalLower = canonicalTopic.toLowerCase();
    return (
      topicClean === canonicalLower ||
      topicClean.includes(canonicalLower) ||
      aliases.some((alias) => topicClean.includes(alias) || (topicClean.length >= 4 && alias.includes(topicClean)))
    );
  });
}

function selectStaticGkEntries(
  chapter: string,
  count: number,
  options?: { difficulty?: DifficultyLevel; shuffle?: boolean }
): StaticGkEntry[] {
  const requestedCount = Math.max(1, Math.min(STATIC_GK_ENTRIES.length, Math.round(count || 5)));
  const cleanChapter = String(chapter || '').trim().toLowerCase();
  const shouldShuffle = options?.shuffle !== false;
  const preferredDifficulty = options?.difficulty;

  const isGenericGaRequest =
    !cleanChapter ||
    cleanChapter === 'general' ||
    cleanChapter === 'ga' ||
    cleanChapter === 'gk' ||
    cleanChapter === 'gs' ||
    cleanChapter.includes('general awareness') ||
    cleanChapter.includes('general knowledge') ||
    cleanChapter.includes('daily sectional') ||
    cleanChapter.includes('high-yield practice');

  let matched: StaticGkEntry[] = [];
  if (!isGenericGaRequest) {
    // Identify canonical chapter keys matching requested chapter/alias
    const matchedTopics = new Set<string>();
    for (const [canonicalTopic, aliases] of Object.entries(CHAPTER_ALIASES)) {
      const canonicalLower = canonicalTopic.toLowerCase();
      if (
        cleanChapter === canonicalLower ||
        cleanChapter.includes(canonicalLower) ||
        aliases.some((alias) => cleanChapter.includes(alias) || alias.includes(cleanChapter))
      ) {
        matchedTopics.add(canonicalTopic);
      }
    }

    matched = STATIC_GK_ENTRIES.filter((entry) => {
      if (matchedTopics.has(entry.topic)) return true;
      const entryTopicLower = entry.topic.toLowerCase();
      return (
        entryTopicLower.includes(cleanChapter) ||
        cleanChapter.includes(entryTopicLower) ||
        entry.questionEn.toLowerCase().includes(cleanChapter) ||
        (entry.explanationEn ?? '').toLowerCase().includes(cleanChapter)
      );
    });
  }

  const orderPool = (pool: StaticGkEntry[]): StaticGkEntry[] => {
    const arranged = shouldShuffle ? shuffleInPlace(pool) : [...pool];
    if (!preferredDifficulty) return arranged;
    const diffMatched = arranged.filter((item) => item.difficulty === preferredDifficulty);
    const diffRest = arranged.filter((item) => item.difficulty !== preferredDifficulty);
    return [...diffMatched, ...diffRest];
  };

  const primaryPool = matched.length > 0 ? orderPool(matched) : orderPool(STATIC_GK_ENTRIES);
  const picked: StaticGkEntry[] = primaryPool.slice(0, requestedCount);

  if (picked.length < requestedCount) {
    const pickedIds = new Set(picked.map((p) => p.seedId));
    const remainder = orderPool(STATIC_GK_ENTRIES.filter((entry) => !pickedIds.has(entry.seedId)));
    for (const item of remainder) {
      if (picked.length >= requestedCount) break;
      picked.push(item);
    }
  }

  return picked;
}

/**
 * Fetches verified, hallucination-free static General Awareness questions matching the requested chapter/sub-topic.
 * Returns QuestionInput[] in the exact shape expected by AI question generators & Admin preview workflows.
 */
export function fetchStaticGKQuestions(
  chapter: string,
  count: number,
  options?: { difficulty?: DifficultyLevel; shuffle?: boolean }
): QuestionInput[] {
  return selectStaticGkEntries(chapter, count, options).map(({ seedId: _seedId, ...qInput }) => ({
    ...qInput,
    optionsEn: [...qInput.optionsEn] as [string, string, string, string],
    ...(qInput.optionsHi
      ? { optionsHi: [...qInput.optionsHi] as [string, string, string, string] }
      : {}),
  }));
}

/**
 * Same verified static GK selector returning normalized QuestionDoc[] with deterministic seed IDs
 * (`static_gk_01`...) so tests can launch directly into TcsIonTestEngine without extra Firestore writes.
 */
export function fetchStaticGKQuestionDocs(
  chapter: string,
  count: number,
  options?: { difficulty?: DifficultyLevel; shuffle?: boolean }
): QuestionDoc[] {
  return selectStaticGkEntries(chapter, count, options).map(({ seedId, ...qInput }) => ({
    id: seedId,
    ...qInput,
    optionsEn: [...qInput.optionsEn] as [string, string, string, string],
    ...(qInput.optionsHi
      ? { optionsHi: [...qInput.optionsHi] as [string, string, string, string] }
      : {}),
    createdBy: 'verified_static_gk_bank',
    createdAt: 1,
    updatedAt: 1,
  }));
}

export function getAllStaticGkQuestionDocs(): QuestionDoc[] {
  return STATIC_GK_ENTRIES.map(({ seedId, ...qInput }) => ({
    id: seedId,
    ...qInput,
    optionsEn: [...qInput.optionsEn] as [string, string, string, string],
    ...(qInput.optionsHi
      ? { optionsHi: [...qInput.optionsHi] as [string, string, string, string] }
      : {}),
    createdBy: 'verified_static_gk_bank',
    createdAt: 1,
    updatedAt: 1,
  }));
}
