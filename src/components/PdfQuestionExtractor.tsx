import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileText,
  FileUp,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { aiExtractQuestionsFromRawPdfText } from '../lib/aiClient';
import { addQuestionsBatch } from '../lib/firestoreService';
import type { SubjectKey } from '../types/exam';
import {
  KEY_TO_STRICT_SUBJECT,
  STRICT_INGEST_SUBJECT_NAMES,
  STRICT_SUBJECT_TO_KEY,
  type StrictIngestSubjectName,
} from '../utils/pdfIngestor';
import {
  chunkRawPdfText,
  toExtractedFirestoreQuestions,
  type ExtractedPdfQuestionRow,
} from '../utils/pdfQuestionExtractor';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfQuestionExtractorProps {
  adminUid: string;
  onNotify?: (type: 'ok' | 'err', text: string) => void;
}

type ExtractorPhase = 'idle' | 'parsing_pdf' | 'extracting_ai' | 'saving_firestore';

interface ProgressStatus {
  phase: ExtractorPhase;
  currentStep: number;
  totalSteps: number;
  message: string;
}

interface BannerMessage {
  type: 'ok' | 'err' | 'info';
  title: string;
  detail?: string;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function extractRawTextFromPdf(
  file: File,
  onPage: (pageNum: number, totalPages: number) => void
): Promise<{ rawText: string; totalPages: number }> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  if (!totalPages || totalPages < 1) {
    throw new Error('The selected PDF contains 0 readable pages.');
  }

  const pageBlocks: string[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    onPage(pageNum, totalPages);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const lines: string[] = [];
    let currentLine = '';
    for (const rawItem of textContent.items) {
      if (!('str' in rawItem)) continue;
      const item = rawItem as { str: string; hasEOL?: boolean };
      currentLine += item.str;
      if (item.hasEOL) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
      } else {
        currentLine += ' ';
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    const pageText = lines.join('\n').trim();
    if (pageText) {
      pageBlocks.push(`--- Page ${pageNum} ---\n${pageText}`);
    }
  }

  return {
    rawText: pageBlocks.join('\n\n').trim(),
    totalPages,
  };
}

export const PdfQuestionExtractor: React.FC<PdfQuestionExtractorProps> = ({
  adminUid,
  onNotify,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [rawText, setRawText] = useState('');
  const [showRawText, setShowRawText] = useState(false);

  const [rows, setRows] = useState<ExtractedPdfQuestionRow[]>([]);
  const [subjectFilter, setSubjectFilter] = useState<'all' | StrictIngestSubjectName>('all');
  const [skippedCount, setSkippedCount] = useState(0);

  const [progress, setProgress] = useState<ProgressStatus>({
    phase: 'idle',
    currentStep: 0,
    totalSteps: 0,
    message: '',
  });
  const [banner, setBanner] = useState<BannerMessage | null>(null);

  const isBusy = progress.phase !== 'idle';

  useEffect(() => {
    if (!banner || banner.type === 'err') return;
    const timer = window.setTimeout(() => setBanner(null), 7000);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const runAiExtraction = useCallback(async (textToProcess: string, pageTotal: number) => {
    const chunks = chunkRawPdfText(textToProcess);
    if (chunks.length === 0) {
      setBanner({
        type: 'err',
        title: 'No selectable text detected in this PDF.',
        detail:
          'This file appears to be scanned images only. Run OCR to add a text layer first, or import via Strict JSON.',
      });
      return;
    }

    const collected: ExtractedPdfQuestionRow[] = [];
    let totalSkipped = 0;
    const chunkErrors: string[] = [];

    for (let i = 0; i < chunks.length; i += 1) {
      setProgress({
        phase: 'extracting_ai',
        currentStep: i + 1,
        totalSteps: chunks.length,
        message: `Extracting MCQs with AI · Segment ${i + 1} of ${chunks.length}...`,
      });
      try {
        const res = await aiExtractQuestionsFromRawPdfText({ rawTextChunk: chunks[i] });
        collected.push(...res.rows);
        totalSkipped += res.skippedCount;
      } catch (err) {
        chunkErrors.push(err instanceof Error ? err.message : 'AI extraction failed.');
      }
    }

    setRows(collected);
    setSkippedCount(totalSkipped);
    setSubjectFilter('all');

    if (collected.length === 0 && chunkErrors.length > 0) {
      setBanner({
        type: 'err',
        title: 'AI extraction failed.',
        detail: chunkErrors[0],
      });
    } else if (collected.length === 0) {
      setBanner({
        type: 'info',
        title: 'No multiple-choice questions detected.',
        detail: `Analyzed ${pageTotal} PDF page(s) across ${chunks.length} text segment(s).`,
      });
    } else if (chunkErrors.length > 0) {
      setBanner({
        type: 'err',
        title: `Extracted ${collected.length} questions (${chunkErrors.length} segment failed).`,
        detail: chunkErrors[0],
      });
    } else {
      setBanner({
        type: 'ok',
        title: `Auto-extracted ${collected.length} questions from ${pageTotal} page(s).`,
        detail: 'Review the table below, adjust any field if needed, then click Save to Firestore.',
      });
    }
  }, []);

  const processPdfFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      const isPdf =
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        setBanner({
          type: 'err',
          title: 'Invalid file format.',
          detail: 'Please select or drop a valid .pdf document.',
        });
        return;
      }

      setSelectedFile(file);
      setBanner(null);
      setRows([]);
      setSkippedCount(0);
      setRawText('');
      setTotalPages(0);

      try {
        setProgress({
          phase: 'parsing_pdf',
          currentStep: 0,
          totalSteps: 1,
          message: 'Parsing PDF raw text in browser...',
        });

        const parsed = await extractRawTextFromPdf(file, (cur, total) => {
          setProgress({
            phase: 'parsing_pdf',
            currentStep: cur,
            totalSteps: total,
            message: `Parsing PDF page ${cur} of ${total}...`,
          });
        });

        setRawText(parsed.rawText);
        setTotalPages(parsed.totalPages);

        if (!parsed.rawText.trim()) {
          setBanner({
            type: 'err',
            title: 'PDF parsed, but zero selectable text was found.',
            detail:
              'If this is a scanned image-only PDF, run OCR before uploading or use the Strict JSON uploader tab.',
          });
          return;
        }

        await runAiExtraction(parsed.rawText, parsed.totalPages);
      } catch (err) {
        setBanner({
          type: 'err',
          title: 'PDF parsing failed.',
          detail: err instanceof Error ? err.message : 'Unable to read this PDF document.',
        });
      } finally {
        setProgress({
          phase: 'idle',
          currentStep: 0,
          totalSteps: 0,
          message: '',
        });
      }
    },
    [runAiExtraction]
  );

  const handleRerunAi = async () => {
    if (!rawText.trim() || isBusy) return;
    setBanner(null);
    try {
      await runAiExtraction(rawText, totalPages || 1);
    } finally {
      setProgress({ phase: 'idle', currentStep: 0, totalSteps: 0, message: '' });
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (isBusy) return;
    const file = e.dataTransfer.files?.[0];
    void processPdfFile(file);
  };

  const handleUpdateRowSubject = (clientKey: string, nextStrict: StrictIngestSubjectName) => {
    const nextKey: SubjectKey = STRICT_SUBJECT_TO_KEY[nextStrict];
    setRows((prev) =>
      prev.map((row) =>
        row.clientKey === clientKey
          ? {
              ...row,
              subject: nextStrict,
              strictSubject: nextStrict,
              subjectKey: nextKey,
            }
          : row
      )
    );
  };

  const handleUpdateRowTopic = (clientKey: string, nextTopic: string) => {
    setRows((prev) =>
      prev.map((row) => (row.clientKey === clientKey ? { ...row, topic: nextTopic } : row))
    );
  };

  const handleUpdateCorrectIndex = (clientKey: string, nextIdx: 0 | 1 | 2 | 3) => {
    setRows((prev) =>
      prev.map((row) =>
        row.clientKey === clientKey ? { ...row, correctIndex: nextIdx } : row
      )
    );
  };

  const handleRemoveRow = (clientKey: string) => {
    setRows((prev) => prev.filter((row) => row.clientKey !== clientKey));
  };

  const handleSaveToFirestore = async () => {
    if (rows.length === 0 || isBusy) return;

    setProgress({
      phase: 'saving_firestore',
      currentStep: 1,
      totalSteps: 1,
      message: `Saving ${rows.length} questions to Firestore via writeBatch...`,
    });

    try {
      const sourceTag = selectedFile?.name
        ? `PDF: ${selectedFile.name.replace(/\.pdf$/i, '').slice(0, 50)}`
        : 'PDF Auto-Extractor';
      const firestorePayload = toExtractedFirestoreQuestions(rows, sourceTag);
      const savedCount = await addQuestionsBatch(firestorePayload, adminUid);

      setRows([]);
      setSkippedCount(0);
      setSubjectFilter('all');
      const okMsg = `Saved ${savedCount} extracted question(s) to Firestore questions collection.`;
      setBanner({
        type: 'ok',
        title: okMsg,
        detail: 'Questions are now live in the Question Bank and Custom Mock filters.',
      });
      onNotify?.('ok', okMsg);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Firestore writeBatch failed while saving questions.';
      setBanner({
        type: 'err',
        title: 'Save to Firestore Failed.',
        detail: errMsg,
      });
      onNotify?.('err', errMsg);
    } finally {
      setProgress({ phase: 'idle', currentStep: 0, totalSteps: 0, message: '' });
    }
  };

  const subjectCounts = useMemo(() => {
    const counts: Record<StrictIngestSubjectName, number> = {
      'Quantitative Aptitude': 0,
      'General Intelligence and Reasoning': 0,
      'English Comprehension': 0,
      'General Awareness': 0,
    };
    for (const row of rows) {
      counts[row.strictSubject] += 1;
    }
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (subjectFilter === 'all') return rows;
    return rows.filter((r) => r.strictSubject === subjectFilter);
  }, [rows, subjectFilter]);

  const progressPct = useMemo(() => {
    if (progress.phase === 'idle') return 0;
    if (progress.phase === 'saving_firestore') return 100;
    if (progress.totalSteps <= 0) return 15;
    return Math.min(100, Math.max(6, Math.round((progress.currentStep / progress.totalSteps) * 100)));
  }, [progress]);

  return (
    <div className="space-y-6">
      {banner && (
        <div
          role={banner.type === 'err' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            banner.type === 'ok'
              ? 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/35 text-emerald-900 dark:text-emerald-200'
              : banner.type === 'err'
                ? 'border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/35 text-red-900 dark:text-red-200'
                : 'border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/35 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {banner.type === 'ok' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <div className="space-y-0.5">
              <p className="font-semibold">{banner.title}</p>
              {banner.detail && <p className="opacity-90">{banner.detail}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss extractor message"
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Upload + Parsing + AI Generation Card */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#181d27] p-6 space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              PDF Auto-Extractor &amp; Saver
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Drop a <span className="font-mono">.pdf</span> question paper to extract raw text via pdf.js, structure MCQs with AI, preview rows, and save via Firestore <span className="font-mono">writeBatch</span>.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap shrink-0">
            <span>{totalPages} pages</span>
            <span aria-hidden="true">·</span>
            <span>{rawText.length.toLocaleString()} chars</span>
            <span aria-hidden="true">·</span>
            <span>{rows.length} MCQs</span>
          </div>
        </div>

        {/* Drag-and-Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!isBusy) setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={handleDrop}
          className={`flex min-h-[184px] flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${
            dragActive
              ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/25'
              : selectedFile
                ? 'border-emerald-300 dark:border-emerald-700/70 bg-emerald-50/40 dark:bg-emerald-950/15 p-6'
                : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-[#131720] hover:border-blue-500'
          } ${isBusy ? 'opacity-60 pointer-events-none' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            data-testid="pdf-auto-extractor-file-input"
            onChange={(e) => {
              void processPdfFile(e.target.files?.[0]);
              e.target.value = '';
            }}
            className="hidden"
          />

          {selectedFile ? (
            <div className="space-y-2.5">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-[#181d27] text-emerald-700 dark:text-emerald-400">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100 break-all">
                {selectedFile.name}
              </p>
              <p className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {formatFileSize(selectedFile.size)}
                {totalPages > 0 ? ` · ${totalPages} page(s) parsed` : ''}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#181d27] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Choose Another PDF</span>
                </button>
                {rawText && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleRerunAi()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Re-run AI Extraction</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full min-h-[184px] flex-col items-center justify-center rounded-xl p-6 space-y-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#181d27] text-blue-700 dark:text-blue-400">
                <FileUp className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Drag &amp; drop a <span className="font-mono">.pdf</span> exam paper here, or click to upload
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Automatically parses raw PDF text locally, extracts structured MCQs with AI, and prepares a review table.
              </span>
            </button>
          )}
        </div>

        {/* Active Loading Spinner & Progress */}
        {isBusy && (
          <div className="rounded-xl border border-blue-200 dark:border-blue-800/60 bg-blue-50/70 dark:bg-blue-950/25 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-blue-950 dark:text-blue-200">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
                <span>{progress.message}</span>
              </div>
              <span className="font-mono tabular-nums">{progressPct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-200/70 dark:bg-blue-900/50">
              <div
                className="h-full bg-blue-700 dark:bg-blue-400 transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Raw Text Inspection Toggle */}
        {rawText && !isBusy && (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">
                Extracted raw text from <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{totalPages}</span> PDF page(s)
              </span>
              <button
                type="button"
                onClick={() => setShowRawText((v) => !v)}
                className="font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                {showRawText ? 'Hide Raw Text' : 'Inspect Raw Text'}
              </button>
            </div>
            {showRawText && (
              <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#11151d] p-3 font-mono text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                {rawText}
              </pre>
            )}
          </div>
        )}
      </section>

      {/* Extracted Questions Preview Table & Batch Save */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#181d27] p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Extracted Questions Preview ({rows.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Review AI-parsed subjects, topics, questions, options, and correct answers before saving to Firestore.
              {skippedCount > 0 ? ` (${skippedCount} incomplete item(s) skipped.)` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {rows.length > 0 && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setRows([]);
                  setSkippedCount(0);
                  setSubjectFilter('all');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear All</span>
              </button>
            )}
            <button
              type="button"
              disabled={rows.length === 0 || isBusy}
              onClick={() => void handleSaveToFirestore()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap cursor-pointer transition-colors"
            >
              {progress.phase === 'saving_firestore' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Saving to Firestore...</span>
                </>
              ) : (
                <>
                  <Database className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Save to Firestore ({rows.length})</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Subject Filter Tabs */}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSubjectFilter('all')}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                subjectFilter === 'all'
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              All ({rows.length})
            </button>
            {STRICT_INGEST_SUBJECT_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setSubjectFilter(name)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                  subjectFilter === name
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {name} ({subjectCounts[name]})
              </button>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#131720] px-6 py-12 text-center space-y-2">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#181d27] text-blue-700 dark:text-blue-400">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              No extracted questions to preview yet
            </p>
            <p className="mx-auto max-w-md text-xs text-slate-500 dark:text-slate-400">
              Upload a <span className="font-mono">.pdf</span> file above to automatically parse text, extract MCQs with AI, and inspect the JSON table before saving to Firestore.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[920px] border-collapse text-left text-xs">
              <thead className="bg-slate-50 dark:bg-[#131720] border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2.5 w-12">#</th>
                  <th className="px-3 py-2.5 min-w-[210px] w-56">Subject</th>
                  <th className="px-3 py-2.5 min-w-[170px] w-44">Topic</th>
                  <th className="px-3 py-2.5 min-w-[260px]">Question</th>
                  <th className="px-3 py-2.5 min-w-[230px]">Options &amp; Correct Index</th>
                  <th className="px-3 py-2.5 w-16 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredRows.map((row, idx) => (
                  <tr
                    key={row.clientKey}
                    className="align-top hover:bg-slate-50/70 dark:hover:bg-[#1e2431]/50"
                  >
                    <td className="px-3 py-3 font-mono font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        aria-label={`Subject for extracted question ${idx + 1}`}
                        value={row.strictSubject}
                        onChange={(e) =>
                          handleUpdateRowSubject(
                            row.clientKey,
                            e.target.value as StrictIngestSubjectName
                          )
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
                      >
                        {STRICT_INGEST_SUBJECT_NAMES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        key: {row.subjectKey} ({KEY_TO_STRICT_SUBJECT[row.subjectKey].split(' ')[0]})
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        aria-label={`Topic for extracted question ${idx + 1}`}
                        value={row.topic}
                        onChange={(e) => handleUpdateRowTopic(row.clientKey, e.target.value)}
                        maxLength={80}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-slate-900 dark:text-slate-100 whitespace-pre-line leading-relaxed">
                        {row.questionEn}
                      </p>
                    </td>
                    <td className="px-3 py-3 space-y-1.5">
                      <div className="space-y-1">
                        {row.optionsEn.map((opt, optIdx) => {
                          const isCorrect = row.correctIndex === optIdx;
                          return (
                            <div
                              key={optIdx}
                              className={`rounded px-2 py-1 text-[11px] ${
                                isCorrect
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 font-semibold text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800/60'
                                  : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <span className="font-mono mr-1.5">{OPTION_LETTERS[optIdx]}.</span>
                              <span>{opt}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <label
                          htmlFor={`correct-idx-${row.clientKey}`}
                          className="font-mono text-[10px] font-semibold text-slate-500 dark:text-slate-400"
                        >
                          correctIndex:
                        </label>
                        <select
                          id={`correct-idx-${row.clientKey}`}
                          value={row.correctIndex}
                          onChange={(e) =>
                            handleUpdateCorrectIndex(
                              row.clientKey,
                              Number(e.target.value) as 0 | 1 | 2 | 3
                            )
                          }
                          className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                        >
                          {OPTION_LETTERS.map((letter, optIdx) => (
                            <option key={letter} value={optIdx}>
                              {optIdx} ({letter})
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(row.clientKey)}
                        aria-label={`Remove extracted question ${idx + 1}`}
                        title="Remove question"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
