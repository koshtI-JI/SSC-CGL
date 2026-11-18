import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiExplainQuestion,
  aiFormulaLookup,
  aiGenerateDailyPack,
  aiGenerateQuestions,
  aiIngestPdfChunk,
  aiPostMortemAnalysis,
  clearAiCacheForTests,
  getMissingGroqKeyMessage,
  GROQ_MODELS,
  resolveViteGroqApiKey,
} from './aiClient';

test('GROQ_MODELS prioritizes openai/gpt-oss-120b with fallbacks', () => {
  assert.equal(GROQ_MODELS[0], 'openai/gpt-oss-120b');
  assert.ok(GROQ_MODELS.length >= 4);
});

test('resolveViteGroqApiKey returns null for missing, empty, or placeholder values', () => {
  assert.equal(resolveViteGroqApiKey({}), null);
  assert.equal(resolveViteGroqApiKey({ VITE_GROQ_API_KEY: '' }), null);
  assert.equal(resolveViteGroqApiKey({ VITE_GROQ_API_KEY: '   ' }), null);
  assert.equal(resolveViteGroqApiKey({ VITE_GROQ_API_KEY: 'MY_GROQ_API_KEY' }), null);
  assert.equal(resolveViteGroqApiKey({ VITE_GROQ_API_KEY: '  gsk_realKey123  ' }), 'gsk_realKey123');
  assert.ok(getMissingGroqKeyMessage().includes('VITE_GROQ_API_KEY'));
});

test('aiExplainQuestion and aiFormulaLookup never throw deadlocks when Groq key is missing (offline fallback)', async () => {
  clearAiCacheForTests();
  const explainRes = await aiExplainQuestion({
    questionEn: '2 + 2 = ?',
    optionsEn: ['3', '4', '5', '6'],
    correctIndex: 1,
    selectedIndex: 0,
    subject: 'quant',
    topic: 'Arithmetic',
  });
  assert.ok(explainRes.explanation.includes('Option B) 4'));
  assert.ok(explainRes.explanation.includes('Hindi'));

  const formulaRes = await aiFormulaLookup({
    query: 'Percentage',
    subject: 'quant',
    lang: 'hi',
  });
  assert.ok(formulaRes.cards.length >= 1);
  assert.equal(formulaRes.cards[0].subject, 'quant');
});

test('aiPostMortemAnalysis computes negative-mark leakage and recovery plan offline', async () => {
  clearAiCacheForTests();
  const report = await aiPostMortemAnalysis({
    testTitle: 'Tier-II Paper-I Mock',
    targetPost: 'ASO in MEA',
    score: 210,
    maxScore: 300,
    accuracy: 80,
    correctCount: 75,
    wrongCount: 15,
    skippedCount: 10,
    negativeMarks: 1,
    positiveMarks: 3,
    weakTopics: ['Trigonometry', 'Cloze Test'],
    slowestSection: 'Quantitative Aptitude',
  });
  assert.equal(report.marksLostToNegative, 15);
  assert.ok(report.potentialBoostMarks > 0);
  assert.equal(report.actionChecklist.length, 3);
  assert.ok(report.headline.includes('15'));
});

test('aiGenerateQuestions NEVER invokes Groq fetch for General Awareness (routes to verified static GK bank)', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('Groq API must NEVER be called for General Awareness');
  }) as typeof fetch;

  try {
    const res = await aiGenerateQuestions({
      subject: 'ga',
      topic: 'History',
      difficulty: 'medium',
      count: 4,
    });
    assert.equal(fetchCalled, false);
    assert.equal(res.questions.length, 4);
    for (const q of res.questions) {
      assert.equal(q.subject, 'ga');
      assert.equal(q.optionsEn.length, 4);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('aiGenerateDailyPack requests only quant, reasoning, and english from Groq and merges static GA questions', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
  if (originalEnv) {
    originalEnv.VITE_GROQ_API_KEY = 'gsk_test_dummy_key';
  }
  let capturedPrompt = '';

  globalThis.fetch = (async (_url, init) => {
    const parsedBody = JSON.parse(String(init?.body || '{}')) as {
      messages?: Array<{ content?: string }>;
    };
    capturedPrompt = parsedBody.messages?.[0]?.content || '';

    const mockAiPayload = {
      questions: [
        {
          subject: 'quant',
          topic: 'Percentage',
          difficulty: 'medium',
          questionEn: 'What is 25% of 200?',
          optionsEn: ['25', '50', '75', '100'],
          correctIndex: 1,
        },
        {
          subject: 'reasoning',
          topic: 'Coding-Decoding',
          difficulty: 'easy',
          questionEn: 'If CAT = 24, what is DOG?',
          optionsEn: ['26', '27', '28', '29'],
          correctIndex: 0,
        },
        {
          subject: 'english',
          topic: 'Synonyms',
          difficulty: 'easy',
          questionEn: 'Synonym of ABUNDANT is:',
          optionsEn: ['Scarce', 'Plentiful', 'Brief', 'Tiny'],
          correctIndex: 1,
        },
        {
          // Deliberate rogue AI GA item to prove the filter rejects it
          subject: 'ga',
          topic: 'Hallucinated GK',
          difficulty: 'hard',
          questionEn: 'Hallucinated AI GK question',
          optionsEn: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
        },
      ],
    };

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(mockAiPayload) } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const pack = await aiGenerateDailyPack({
      dateKey: '2026-11-15',
      perSubject: 1,
      env: { VITE_GROQ_API_KEY: 'gsk_test_dummy_key' },
    });
    assert.ok(capturedPrompt.includes('Do NOT generate General Awareness'));
    assert.equal(
      pack.questions.some((q) => q.questionEn === 'Hallucinated AI GK question'),
      false
    );
    assert.equal(pack.questions.filter((q) => q.subject === 'ga').length, 1);
    assert.equal(pack.questions.filter((q) => q.subject === 'quant').length, 1);
    assert.equal(pack.questions.filter((q) => q.subject === 'reasoning').length, 1);
    assert.equal(pack.questions.filter((q) => q.subject === 'english').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runtime UI Groq API key overrides missing .env seamlessly and clears cleanly', async () => {
  const {
    aiChatMentor,
    aiTranslateBatch,
    clearRuntimeGroqApiKey,
    getAiEngineStatus,
    resolveEffectiveGroqApiKey,
    setRuntimeGroqApiKey,
  } = await import('./aiClient');

  clearAiCacheForTests();
  const originalEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
  if (originalEnv) {
    delete originalEnv.VITE_GROQ_API_KEY;
  }

  assert.equal(resolveEffectiveGroqApiKey().source, 'none');

  // Missing key: aiChatMentor & aiTranslateBatch never throw
  const offlineChat = await aiChatMentor({
    message: 'How do XP rules work?',
    history: [{ role: 'user', text: 'How do XP rules work?' }],
    studentName: 'Damini',
    targetPost: 'ASO in MEA',
  });
  assert.ok(offlineChat.reply.includes('>80%'));

  const offlineTr = await aiTranslateBatch({
    questions: [{ subject: 'quant', questionEn: 'Solve x+2=5', optionsEn: ['1', '2', '3', '4'] }],
  });
  assert.deepEqual(offlineTr.translations, []);

  setRuntimeGroqApiKey('gsk_user_runtime_123456');
  assert.equal(resolveEffectiveGroqApiKey().source, 'ui');
  assert.equal(resolveEffectiveGroqApiKey().key, 'gsk_user_runtime_123456');
  assert.equal(getAiEngineStatus().hasKey, true);
  assert.equal(getAiEngineStatus().keySource, 'ui');

  clearRuntimeGroqApiKey();
  assert.equal(resolveEffectiveGroqApiKey().source, 'none');
});

test('multi-provider runtime AI config routes to custom baseUrl and model cleanly', async () => {
  const {
    clearRuntimeAiConfig,
    getAiEngineStatus,
    resolveEffectiveAiConfig,
    setRuntimeAiConfig,
    testAiConnection,
  } = await import('./aiClient');

  clearAiCacheForTests();
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedModel = '';

  globalThis.fetch = (async (url, init) => {
    capturedUrl = String(url);
    const parsed = JSON.parse(String(init?.body || '{}')) as { model?: string };
    capturedModel = parsed.model || '';
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    setRuntimeAiConfig({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test-openai-key-1234',
    });

    const eff = resolveEffectiveAiConfig();
    assert.equal(eff.provider, 'openai');
    assert.equal(eff.baseUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(eff.model, 'gpt-4o-mini');
    assert.equal(getAiEngineStatus().provider, 'openai');

    const conn = await testAiConnection();
    assert.equal(conn.ok, true);
    assert.equal(capturedUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(capturedModel, 'gpt-4o-mini');
  } finally {
    globalThis.fetch = originalFetch;
    clearRuntimeAiConfig();
  }
});

test('aiIngestPdfChunk returns clear row error and skips fetch for scanned image-only chunks', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('fetch must not be called when chunk has no selectable text');
  }) as typeof fetch;

  try {
    const res = await aiIngestPdfChunk({
      shiftExamName: '14 July 2023 S1',
      subjectMode: 'auto',
      chunk: {
        chunkIndex: 0,
        startPage: 1,
        endPage: 2,
        pageRangeLabel: 'Pages 1-2',
        pages: [
          { pageNumber: 1, text: '   ', imageBase64: 'ZmFrZV9pbWFnZQ==', mimeType: 'image/jpeg' },
          { pageNumber: 2, text: '', imageBase64: 'ZmFrZV9pbWFnZQ==', mimeType: 'image/jpeg' },
        ],
      },
    });
    assert.equal(fetchCalled, false);
    assert.deepEqual(res.items, []);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0].message, /Pages 1-2/);
    assert.match(res.errors[0].message, /no selectable text/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


