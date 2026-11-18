import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoTagTopicBySubject,
  buildPdfExtractionPrompt,
  chunkPdfPages,
  parseAiPdfQuestionsJson,
  parseStrictIngestJson,
  parseStrictIngestSubject,
  stripJsonCodeFences,
  toFirestoreQuestionInputs,
  type PdfPageContent,
} from './pdfIngestor';

test('chunkPdfPages groups PDF pages 5 at a time and skips empty pages', () => {
  const pages: PdfPageContent[] = Array.from({ length: 12 }, (_, idx) => ({
    pageNumber: idx + 1,
    text: idx >= 5 && idx <= 9 ? '   ' : `Q${idx + 1}. Sample SSC question text`,
  }));

  const chunks = chunkPdfPages(pages, 5);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].pageRangeLabel, 'Pages 1–5');
  assert.equal(chunks[0].pages.length, 5);
  assert.equal(chunks[1].pageRangeLabel, 'Pages 11–12');
  assert.equal(chunks[1].pages.length, 2);
});

test('chunkPdfPages retains scanned pages that carry JPEG imageBase64 even when text is empty', () => {
  const chunks = chunkPdfPages(
    [
      { pageNumber: 1, text: '', imageBase64: 'fakeBase64JpegData', mimeType: 'image/jpeg' },
      { pageNumber: 2, text: '' },
    ],
    5
  );
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].pageRangeLabel, 'Pages 1–2');
});

test('buildPdfExtractionPrompt includes strict 4-subject schema and shift metadata', () => {
  const prompt = buildPdfExtractionPrompt({
    shiftExamName: 'CGL Tier-1 2026 Shift 1',
    subjectMode: 'Quantitative Aptitude',
    pageRangeLabel: 'Pages 1–5',
  });

  assert.match(prompt, /Extract all multiple-choice questions from this document\./);
  assert.match(prompt, /Output ONLY a valid JSON array of objects\./);
  assert.match(prompt, /"Quantitative Aptitude" \| "General Intelligence and Reasoning" \| "English Comprehension" \| "General Awareness"/);
  assert.match(prompt, /CGL Tier-1 2026 Shift 1/);
  assert.match(prompt, /Set "subject" on EVERY extracted question strictly to "Quantitative Aptitude"/);
});

test('stripJsonCodeFences unwraps markdown json fences cleanly', () => {
  const raw = '```json\n[{"topic":"Algebra"}]\n```';
  assert.equal(stripJsonCodeFences(raw), '[{"topic":"Algebra"}]');
});

test('parseStrictIngestSubject accepts only the 4 canonical strict SSC subject names', () => {
  assert.deepEqual(parseStrictIngestSubject('Quantitative Aptitude'), {
    ok: true,
    strictName: 'Quantitative Aptitude',
    subjectKey: 'quant',
  });
  assert.deepEqual(parseStrictIngestSubject('General Intelligence and Reasoning'), {
    ok: true,
    strictName: 'General Intelligence and Reasoning',
    subjectKey: 'reasoning',
  });
  assert.deepEqual(parseStrictIngestSubject('English Comprehension'), {
    ok: true,
    strictName: 'English Comprehension',
    subjectKey: 'english',
  });
  assert.deepEqual(parseStrictIngestSubject('General Awareness'), {
    ok: true,
    strictName: 'General Awareness',
    subjectKey: 'ga',
  });

  for (const invalid of ['quant', 'Maths', 'Mathematics', 'GK', 'Reasoning', 'English', '']) {
    const res = parseStrictIngestSubject(invalid);
    assert.equal(res.ok, false, `Expected "${invalid}" to be rejected`);
  }
});

test('autoTagTopicBySubject strictly prevents cross-subject topic contamination', () => {
  // Maths question mistagged with an English topic must re-tag strictly within Quant
  const mathsCorrected = autoTagTopicBySubject({
    subjectKey: 'quant',
    rawTopic: 'Error Spotting',
    questionEn: 'If x^2 + 1/x^2 = 7, find the value of x^3 + 1/x^3.',
    explanationEn: 'Using algebra identity (x + 1/x)^2 = 9.',
  });
  assert.equal(mathsCorrected.autoCorrected, true);
  assert.equal(mathsCorrected.topic, 'Algebra');
  assert.equal(mathsCorrected.previousTopic, 'Error Spotting');

  // Reasoning question containing "English dictionary" must stay under Reasoning "Dictionary Order"
  const reasoningDictionary = autoTagTopicBySubject({
    subjectKey: 'reasoning',
    rawTopic: 'Dictionary Order',
    questionEn: 'Select the correct order as words appear in an English dictionary.',
  });
  assert.equal(reasoningDictionary.autoCorrected, false);
  assert.equal(reasoningDictionary.topic, 'Dictionary Order');

  // English question mentioning "percentage" in passage must NOT adopt Maths "Percentage"
  const englishWithNumberWord = autoTagTopicBySubject({
    subjectKey: 'english',
    rawTopic: 'Percentage',
    questionEn: 'Find the grammatical error: The percentage of successful candidates are increasing every year.',
  });
  assert.equal(englishWithNumberWord.autoCorrected, true);
  assert.equal(englishWithNumberWord.topic, 'Error Spotting');
});

test('parseStrictIngestJson parses user canonical English-only PYQ JSON sample cleanly', () => {
  const sample = JSON.stringify([
    {
      examShift: '14 July 2023 S1',
      subject: 'General Intelligence and Reasoning',
      topic: 'Dictionary Order',
      questionEn:
        'Select the option that represents the correct order of the given words as they would appear in an English dictionary.\n1. Warriors\n2. Warehouse\n3. Warcraft\n4. Warranty\n5. Wardrobe\n6. Wardenship',
      optionsEn: [
        '3, 6, 5, 2, 1, 4',
        '3, 5, 6, 2, 1, 4',
        '3, 5, 6, 2, 4, 1',
        '3, 6, 5, 2, 4, 1',
      ],
      correctIndex: 3,
      explanationEn:
        'The correct dictionary order is: 3. Warcraft, 6. Wardenship, 5. Wardrobe, 2. Warehouse, 4. Warranty, 1. Warriors.',
    },
    {
      examShift: '14 July 2023 S1',
      subject: 'General Awareness',
      topic: 'Sports',
      questionEn: 'In which sport is the Thomas Cup awarded?',
      optionsEn: ['Lawn Tennis', 'Badminton', 'Table Tennis', 'Hockey'],
      correctIndex: 1,
      explanationEn: 'Thomas Cup is an international men team badminton championship.',
    },
  ]);

  const result = parseStrictIngestJson(sample);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(result.items.length, 2);

  assert.equal(result.items[0].strictSubject, 'General Intelligence and Reasoning');
  assert.equal(result.items[0].subject, 'reasoning');
  assert.equal(result.items[0].topic, 'Dictionary Order');
  assert.equal(result.items[0].examShift, '14 July 2023 S1');
  assert.equal(result.items[0].metadata?.year, '2023');
  assert.equal(result.items[0].metadata?.shift, 'Shift-1');
  assert.equal(result.items[0].correctIndex, 3);

  assert.equal(result.items[1].strictSubject, 'General Awareness');
  assert.equal(result.items[1].subject, 'ga');
  assert.equal(result.items[1].topic, 'Sports');
  assert.equal(result.items[1].correctIndex, 1);

  const firestorePayloads = toFirestoreQuestionInputs(result.items);
  assert.equal('strictSubject' in firestorePayloads[0], false);
  assert.equal('examShift' in firestorePayloads[0], false);
  assert.equal('autoTaggedFrom' in firestorePayloads[0], false);
  assert.equal(firestorePayloads[0].subject, 'reasoning');
});

test('parseStrictIngestJson rejects alias subject names with clear row errors while retaining valid rows', () => {
  const payload = JSON.stringify([
    {
      examShift: '14 July 2023 S1',
      subject: 'Maths',
      topic: 'Algebra',
      questionEn: 'Solve x + 2 = 5',
      optionsEn: ['1', '2', '3', '4'],
      correctIndex: 2,
      explanationEn: 'x = 3',
    },
    {
      examShift: '14 July 2023 S1',
      subject: 'Quantitative Aptitude',
      topic: 'Synonyms & Antonyms',
      questionEn: 'Find the ratio 12 : 18 in simplest form.',
      optionsEn: ['2:3', '3:2', '1:2', '4:5'],
      correctIndex: 0,
      explanationEn: 'Divide both terms by HCF 6.',
    },
  ]);

  const result = parseStrictIngestJson(payload);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /Row 1: Invalid subject "Maths"/);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].strictSubject, 'Quantitative Aptitude');
  assert.equal(result.items[0].topic, 'Ratio & Proportion');
  assert.equal(result.items[0].autoTaggedFrom, 'Synonyms & Antonyms');
});

test('parseAiPdfQuestionsJson normalizes valid array and attaches shift metadata & Firestore-safe limits', () => {
  const sampleJson = `\`\`\`json
  [
    {
      "examShift": "CGL Tier-1 2026 Shift 1",
      "subject": "Quantitative Aptitude",
      "topic": "Geometry",
      "questionEn": "Find the sum of interior angles of a triangle.",
      "questionHi": "त्रिभुज के आंतरिक कोणों का योग ज्ञात कीजिए।",
      "optionsEn": ["90°", "180°", "270°", "360°"],
      "optionsHi": ["90°", "180°", "270°", "360°"],
      "correctIndex": 1,
      "explanationEn": "Sum of interior angles of any triangle is always 180 degrees.",
      "explanationHi": "किसी भी त्रिभुज के आंतरिक कोणों का योग हमेशा 180 डिग्री होता है।"
    }
  ]
  \`\`\``;

  const { items, skippedCount } = parseAiPdfQuestionsJson(sampleJson, {
    shiftExamName: 'CGL Tier-1 2026 Shift 1',
    subjectMode: 'Quantitative Aptitude',
    pageRangeLabel: 'Pages 1–5',
    chunkIndex: 0,
  });

  assert.equal(skippedCount, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].subject, 'quant');
  assert.equal(items[0].strictSubject, 'Quantitative Aptitude');
  assert.equal(items[0].topic, 'Geometry');
  assert.equal(items[0].correctIndex, 1);
  assert.equal(items[0].yearTag, 'CGL Tier-1 2026 Shift 1');
  assert.equal(items[0].metadata?.year, '2026');
  assert.equal(items[0].metadata?.tier, 'Tier-1');
  assert.equal(items[0].metadata?.shift, 'Shift-1');

  const firestorePayloads = toFirestoreQuestionInputs(items);
  assert.equal('clientKey' in firestorePayloads[0], false);
  assert.equal('pageRangeLabel' in firestorePayloads[0], false);
});

test('parseAiPdfQuestionsJson throws descriptive error on malformed JSON instead of crashing silently', () => {
  assert.throws(
    () =>
      parseAiPdfQuestionsJson('{not valid json at all', {
        shiftExamName: 'CGL Tier-1 2026 Shift 1',
        subjectMode: 'General Intelligence and Reasoning',
        pageRangeLabel: 'Pages 6–10',
      }),
    /malformed JSON.*Pages 6–10/i
  );
});

test('parseAiPdfQuestionsJson skips malformed individual items while keeping valid items', () => {
  const mixed = JSON.stringify([
    {
      subject: 'English Comprehension',
      topic: 'Broken',
      questionEn: 'Only two options',
      optionsEn: ['A', 'B'],
      correctIndex: 0,
    },
    {
      subject: 'English Comprehension',
      topic: 'Synonyms',
      questionEn: 'Select synonym of CANDID.',
      questionHi: 'CANDID का पर्यायवाची चुनें।',
      optionsEn: ['Frank', 'Secretive', 'Cruel', 'Slow'],
      optionsHi: ['स्पष्टवादी', 'गुप्त', 'क्रूर', 'धीमा'],
      correctIndex: 0,
      explanationEn: 'Candid means truthful and straightforward (Frank).',
      explanationHi: 'Candid का अर्थ स्पष्टवादी (Frank) होता है।',
    },
  ]);

  const { items, skippedCount } = parseAiPdfQuestionsJson(mixed, {
    shiftExamName: 'CGL Tier-1 2026 Shift 2',
    subjectMode: 'English Comprehension',
  });

  assert.equal(skippedCount, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].subject, 'english');
  assert.equal(items[0].topic, 'Synonyms & Antonyms');
  assert.equal(items[0].correctIndex, 0);
});
