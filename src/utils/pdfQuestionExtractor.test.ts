import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRawTextMcqExtractionPrompt,
  chunkRawPdfText,
  parseExtractedMcqJson,
  resolveExtractorSubject,
  toExtractedFirestoreQuestions,
} from './pdfQuestionExtractor';

test('buildRawTextMcqExtractionPrompt embeds exact requested JSON schema and raw PDF text', () => {
  const prompt = buildRawTextMcqExtractionPrompt('Q1. What is the capital of India?\nA) Mumbai B) New Delhi C) Kolkata D) Chennai');
  assert.match(prompt, /"subject": "string"/);
  assert.match(prompt, /"topic": "string"/);
  assert.match(prompt, /"questionEn": "string"/);
  assert.match(prompt, /"optionsEn": \["A", "B", "C", "D"\]/);
  assert.match(prompt, /"correctIndex": number \(0-3\)/);
  assert.match(prompt, /What is the capital of India\?/);
});

test('chunkRawPdfText splits large PDF raw text cleanly on paragraph boundaries', () => {
  const para = 'Question stem with four options and solution details.\nA) 1 B) 2 C) 3 D) 4';
  const bigText = Array.from({ length: 45 }, (_, i) => `${i + 1}. ${para}`).join('\n\n');
  const chunks = chunkRawPdfText(bigText, 1600);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 1650);
    assert.ok(chunk.length > 0);
  }
});

test('resolveExtractorSubject normalizes strict names and common aliases to Firestore-safe SubjectKey', () => {
  assert.deepEqual(
    resolveExtractorSubject({ rawSubject: 'Quantitative Aptitude' }),
    { strictSubject: 'Quantitative Aptitude', subjectKey: 'quant' }
  );
  assert.deepEqual(
    resolveExtractorSubject({ rawSubject: 'Mathematics' }),
    { strictSubject: 'Quantitative Aptitude', subjectKey: 'quant' }
  );
  assert.deepEqual(
    resolveExtractorSubject({ rawSubject: 'Reasoning' }),
    { strictSubject: 'General Intelligence and Reasoning', subjectKey: 'reasoning' }
  );
  assert.deepEqual(
    resolveExtractorSubject({ rawSubject: 'English' }),
    { strictSubject: 'English Comprehension', subjectKey: 'english' }
  );
  assert.deepEqual(
    resolveExtractorSubject({ rawSubject: 'GK' }),
    { strictSubject: 'General Awareness', subjectKey: 'ga' }
  );
});

test('parseExtractedMcqJson parses wrapped JSON arrays, skips malformed entries, and maps to Firestore QuestionInput', () => {
  const aiOutput = `\`\`\`json
  [
    {
      "subject": "Quantitative Aptitude",
      "topic": "Percentage",
      "questionEn": "If 20% of x is 50, what is x?",
      "optionsEn": ["200", "250", "300", "400"],
      "correctIndex": 1
    },
    {
      "subject": "English Comprehension",
      "topic": "Broken",
      "questionEn": "Missing options",
      "optionsEn": ["Only one"],
      "correctIndex": 0
    }
  ]
  \`\`\``;

  const { rows, skippedCount } = parseExtractedMcqJson(aiOutput);
  assert.equal(skippedCount, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subjectKey, 'quant');
  assert.equal(rows[0].strictSubject, 'Quantitative Aptitude');
  assert.equal(rows[0].topic, 'Percentage');
  assert.equal(rows[0].correctIndex, 1);

  const firestoreDocs = toExtractedFirestoreQuestions(rows);
  assert.equal(firestoreDocs.length, 1);
  assert.equal(firestoreDocs[0].subject, 'quant');
  assert.equal(firestoreDocs[0].difficulty, 'medium');
  assert.equal(firestoreDocs[0].source, 'PDF Auto-Extractor');
  assert.deepEqual(firestoreDocs[0].optionsEn, ['200', '250', '300', '400']);
});
