import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileJson,
  FileText,
  FileUp,
  Filter,
  Loader2,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { aiIngestPdfChunk } from '../lib/aiClient';
import { addQuestionsBatch } from '../lib/firestoreService';
import {
  chunkPdfPages,
  parseStrictIngestJson,
  PDF_INGEST_PAGES_PER_CHUNK,
  STRICT_INGEST_SUBJECT_NAMES,
  toFirestoreQuestionInputs,
  type IngestedQuestionDraft,
  type PdfPageContent,
  type StrictIngestSubjectName,
} from '../utils/pdfIngestor';
import { WipeQuestionsModal } from './WipeQuestionsModal';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface AdminPdfIngestorProps {
  adminUid: string;
  liveQuestionCount: number;
  onNotify?: (type: 'ok' | 'err', text: string) => void;
}

type IngestSourceTab = 'json' | 'pdf';

interface ToastState {
  id: number;
  type: 'ok' | 'err' | 'info';
  title: string;
  detail?: string;
}

interface ProgressState {
  phase: 'idle' | 'parsing_pdf' | 'extracting_ai' | 'pushing_firestore';
  currentPage: number;
  totalPages: number;
  currentChunk: number;
  totalChunks: number;
  label: string;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

const STRICT_JSON_SAMPLE = JSON.stringify(
  [
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
  ],
  null,
  2
);

const SUBJECT_BADGE_CLASSES: Record<StrictIngestSubjectName, string> = {
  'Quantitative Aptitude':
    'border-blue-200 dark:border-blue-800/70 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200',
  'General Intelligence and Reasoning':
    'border-violet-200 dark:border-violet-800/70 bg-violet-50 dark:bg-violet-950/40 text-violet-800 dark:text-violet-200',
  'English Comprehension':
    'border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200',
  'General Awareness':
    'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function parsePdfLocally(
  file: File,
  onPageProgress: (current: number, total: number) => void
): Promise<{ pages: PdfPageContent[]; totalPages: number }> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  if (!totalPages || totalPages < 1) {
    throw new Error('The uploaded PDF has 0 readable pages.');
  }

  const pages: PdfPageContent[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    onPageProgress(pageNum, totalPages);
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

    const extractedText = lines.join('\n').trim();
    let imageBase64: string | undefined;

    if (extractedText.length < 40 && typeof document !== 'undefined') {
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, Math.max(0.9, 1100 / Math.max(1, baseViewport.width)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx !== -1) {
          imageBase64 = dataUrl.slice(commaIdx + 1);
        }
      }
    }

    pages.push({
      pageNumber: pageNum,
      text: extractedText,
      ...(imageBase64 ? { imageBase64, mimeType: 'image/jpeg' as const } : {}),
    });
  }

  return { pages, totalPages };
}

export const AdminPdfIngestor: React.FC<AdminPdfIngestorProps> = ({
  adminUid,
  liveQuestionCount,
  onNotify,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);

  const [sourceTab, setSourceTab] = useState<IngestSourceTab>('json');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [shiftExamName, setShiftExamName] = useState('14 July 2023 S1');
  const [subjectMode, setSubjectMode] = useState<'auto' | StrictIngestSubjectName>('auto');

  const [jsonInputText, setJsonInputText] = useState('');
  const [rowErrors, setRowErrors] = useState<Array<{ row: number; message: string }>>([]);

  const [previewRows, setPreviewRows] = useState<IngestedQuestionDraft[]>([]);
  const [previewSubjectFilter, setPreviewSubjectFilter] = useState<
    'all' | StrictIngestSubjectName
  >('all');
  const [skippedNotice, setSkippedNotice] = useState<number>(0);

  const [wipeModalOpen, setWipeModalOpen] = useState(false);

  const [progress, setProgress] = useState<ProgressState>({
    phase: 'idle',
    currentPage: 0,
    totalPages: 0,
    currentChunk: 0,
    totalChunks: 0,
    label: '',
  });
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (type: 'ok' | 'err' | 'info', title: string, detail?: string) => {
      setToast({ id: Date.now(), type, title, detail });
    },
    []
  );

  useEffect(() => {
    if (!toast || toast.type === 'err') return;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const isBusy = progress.phase !== 'idle';

  const handleSelectPdf = (file: File | null | undefined) => {
    if (!file) return;
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      showToast('err', 'Unsupported file type.', 'Please upload a valid .pdf question paper.');
      return;
    }
    setSelectedFile(file);
    setToast(null);
    setSkippedNotice(0);
    setRowErrors([]);
  };

  const handleSelectJsonFile = async (file: File | null | undefined) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.json') && file.type !== 'application/json' && !lower.endsWith('.txt')) {
      showToast('err', 'Unsupported file type.', 'Please select a .json PYQ array file.');
      return;
    }
    const text = await file.text();
    setJsonInputText(text);
    setToast(null);
    setRowErrors([]);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (isBusy) return;
    const file = e.dataTransfer.files?.[0];
    handleSelectPdf(file);
  };

  const handleParseStrictJson = () => {
    setToast(null);
    setRowErrors([]);
    setSkippedNotice(0);

    try {
      const result = parseStrictIngestJson(
        jsonInputText,
        shiftExamName.trim() || 'SSC CGL PYQ'
      );
      setPreviewRows(result.items);
      setPreviewSubjectFilter('all');
      setSkippedNotice(result.skippedCount);
      setRowErrors(result.errors);

      if (result.items.length === 0 && result.errors.length > 0) {
        showToast(
          'err',
          `All ${result.errors.length} row(s) rejected by strict subject/schema validation.`,
          result.errors[0].message
        );
      } else if (result.errors.length > 0) {
        showToast(
          'info',
          `Loaded ${result.items.length} valid PYQ(s); rejected ${result.errors.length} row(s).`,
          result.errors[0].message
        );
      } else if (result.items.length === 0) {
        showToast('info', 'JSON array was empty.', 'Provide at least 1 PYQ object.');
      } else {
        const autoFixed = result.items.filter((r) => Boolean(r.autoTaggedFrom)).length;
        showToast(
          'ok',
          `Validated ${result.items.length} strict-routed PYQ(s).`,
          autoFixed > 0
            ? `Topic Auto-Tagger corrected ${autoFixed} row(s) to match their strict subject domain.`
            : 'Review the Preview Data table below, then click Commit to Firestore.'
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to parse JSON input.';
      setPreviewRows([]);
      showToast('err', 'JSON Schema Validation Failed.', message);
    }
  };

  const handleProcessWithAi = async () => {
    if (!selectedFile) {
      showToast('err', 'No PDF selected.', 'Drop or browse a .pdf document first.');
      return;
    }
    const cleanShift = shiftExamName.trim();
    if (cleanShift.length < 3) {
      showToast(
        'err',
        'Shift / Exam Name is required.',
        'Enter a shift tag such as "14 July 2023 S1" or "CGL Tier-1 2026 Shift 1".'
      );
      return;
    }

    setToast(null);
    setSkippedNotice(0);
    setRowErrors([]);
    setPreviewRows([]);
    setPreviewSubjectFilter('all');

    try {
      setProgress({
        phase: 'parsing_pdf',
        currentPage: 0,
        totalPages: 0,
        currentChunk: 0,
        totalChunks: 0,
        label: 'Reading PDF pages locally in your browser...',
      });

      const { pages, totalPages } = await parsePdfLocally(selectedFile, (cur, tot) => {
        setProgress({
          phase: 'parsing_pdf',
          currentPage: cur,
          totalPages: tot,
          currentChunk: 0,
          totalChunks: 0,
          label: `Parsing PDF page ${cur} of ${tot}...`,
        });
      });

      const chunks = chunkPdfPages(pages, PDF_INGEST_PAGES_PER_CHUNK);
      if (chunks.length === 0) {
        throw new Error(
          'No extractable text or visual pages were found inside this PDF document.'
        );
      }

      const collected: IngestedQuestionDraft[] = [];
      const collectedErrors: Array<{ row: number; message: string }> = [];
      let totalSkipped = 0;
      const chunkErrors: string[] = [];

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        setProgress({
          phase: 'extracting_ai',
          currentPage: chunk.endPage,
          totalPages,
          currentChunk: i + 1,
          totalChunks: chunks.length,
          label: `Extracting MCQs with AI · Batch ${i + 1}/${chunks.length} (${chunk.pageRangeLabel})`,
        });

        try {
          const result = await aiIngestPdfChunk({
            shiftExamName: cleanShift,
            subjectMode,
            chunk,
          });
          collected.push(...result.items);
          collectedErrors.push(...result.errors);
          totalSkipped += result.skippedCount;
        } catch (chunkErr) {
          const msg = chunkErr instanceof Error ? chunkErr.message : 'Chunk processing failed.';
          chunkErrors.push(`${chunk.pageRangeLabel}: ${msg}`);
        }
      }

      setPreviewRows(collected);
      setSkippedNotice(totalSkipped);
      setRowErrors(collectedErrors);

      if (collected.length === 0 && chunkErrors.length > 0) {
        showToast('err', 'AI PDF extraction failed.', chunkErrors[0]);
      } else if (collected.length === 0) {
        showToast(
          'info',
          'No multiple-choice questions detected.',
          `Scanned ${totalPages} page(s) in ${chunks.length} batch(es). Verify the PDF contains MCQs.`
        );
      } else if (chunkErrors.length > 0) {
        showToast(
          'err',
          `Extracted ${collected.length} questions with ${chunkErrors.length} failed batch(es).`,
          chunkErrors[0]
        );
      } else {
        showToast(
          'ok',
          `Extracted ${collected.length} strict-routed PYQ(s) from ${totalPages} PDF page(s).`,
          'Verify Subject, Topic, Question, and Correct Answer below, then click Commit to Firestore.'
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to parse PDF document.';
      showToast('err', 'PDF Processing Error.', message);
    } finally {
      setProgress({
        phase: 'idle',
        currentPage: 0,
        totalPages: 0,
        currentChunk: 0,
        totalChunks: 0,
        label: '',
      });
    }
  };

  const handleRemovePreviewRow = (clientKey: string) => {
    setPreviewRows((prev) => prev.filter((row) => row.clientKey !== clientKey));
  };

  const handleClearAllPreview = () => {
    setPreviewRows([]);
    setSkippedNotice(0);
    setRowErrors([]);
    setPreviewSubjectFilter('all');
  };

  const handleCommitToFirestore = async () => {
    if (previewRows.length === 0 || isBusy) return;

    setProgress({
      phase: 'pushing_firestore',
      currentPage: 0,
      totalPages: 0,
      currentChunk: 1,
      totalChunks: 1,
      label: `Committing ${previewRows.length} strictly categorized questions to Firestore...`,
    });

    try {
      const payload = toFirestoreQuestionInputs(previewRows);
      const addedCount = await addQuestionsBatch(payload, adminUid);
      setPreviewRows([]);
      setSkippedNotice(0);
      setRowErrors([]);
      setPreviewSubjectFilter('all');
      showToast(
        'ok',
        `Committed ${addedCount} strictly categorized questions to Firestore.`,
        'All questions passed strict 4-subject routing and Topic Auto-Tagger checks.'
      );
      onNotify?.('ok', `Committed ${addedCount} PYQs to Firestore.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Firestore batch commit failed.';
      showToast('err', 'Commit to Firestore Failed.', message);
      onNotify?.('err', message);
    } finally {
      setProgress({
        phase: 'idle',
        currentPage: 0,
        totalPages: 0,
        currentChunk: 0,
        totalChunks: 0,
        label: '',
      });
    }
  };

  const subjectCounts = useMemo(() => {
    const counts: Record<StrictIngestSubjectName, number> = {
      'Quantitative Aptitude': 0,
      'General Intelligence and Reasoning': 0,
      'English Comprehension': 0,
      'General Awareness': 0,
    };
    for (const row of previewRows) {
      counts[row.strictSubject] += 1;
    }
    return counts;
  }, [previewRows]);

  const filteredPreviewRows = useMemo(() => {
    if (previewSubjectFilter === 'all') return previewRows;
    return previewRows.filter((row) => row.strictSubject === previewSubjectFilter);
  }, [previewRows, previewSubjectFilter]);

  const autoTaggedCount = useMemo(
    () => previewRows.filter((row) => Boolean(row.autoTaggedFrom)).length,
    [previewRows]
  );

  const progressPct = useMemo(() => {
    if (progress.phase === 'parsing_pdf' && progress.totalPages > 0) {
      return Math.round((progress.currentPage / progress.totalPages) * 100);
    }
    if (progress.phase === 'extracting_ai' && progress.totalChunks > 0) {
      return Math.round((progress.currentChunk / progress.totalChunks) * 100);
    }
    if (progress.phase === 'pushing_firestore') return 100;
    return 0;
  }, [progress]);

  return (
    <div className="space-y-6">
      <WipeQuestionsModal
        open={wipeModalOpen}
        liveQuestionCount={liveQuestionCount}
        onClose={() => setWipeModalOpen(false)}
        onWiped={(deleted) => {
          const msg = `Wiped ${deleted} old question(s) from Firestore.`;
          showToast(
            'ok',
            msg,
            'Database is clean. Parse & review your replacement PYQs below, then click Commit to Firestore.'
          );
          onNotify?.('ok', msg);
        }}
        onError={(msg) => {
          showToast('err', 'Wipe Old Database Failed.', msg);
          onNotify?.('err', msg);
        }}
      />

      {toast && (
        <div
          role={toast.type === 'err' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            toast.type === 'ok'
              ? 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/35 text-emerald-900 dark:text-emerald-200'
              : toast.type === 'err'
                ? 'border-red-200 dark:border-red-800/70 bg-red-50 dark:bg-red-950/35 text-red-900 dark:text-red-200'
                : 'border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/35 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {toast.type === 'ok' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <div className="space-y-0.5">
              <p className="font-semibold">{toast.title}</p>
              {toast.detail && <p className="opacity-90">{toast.detail}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Header + Wipe Old Database Control + Source Mode Switcher */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Strict PYQ Ingestor &amp; PDF-to-Firestore Pipeline
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enforces the 4 canonical SSC CGL subjects, runs Topic Auto-Tagger domain isolation, and previews rows before batch commit.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#131720] px-3 py-1.5 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
              Live DB: {liveQuestionCount} Qs
            </span>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setWipeModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3.5 py-2 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Wipe Old Database</span>
            </button>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Ingestor Input Source"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#11151d] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'json'}
              onClick={() => setSourceTab('json')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                sourceTab === 'json'
                  ? 'bg-white dark:bg-[#1e2431] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <FileJson className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <span>Strict JSON / API Uploader</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === 'pdf'}
              onClick={() => setSourceTab('pdf')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                sourceTab === 'pdf'
                  ? 'bg-white dark:bg-[#1e2431] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
              <span>AI PDF Extractor</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Tag className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>
              Allowed <code className="font-mono">subject</code> values: Quantitative Aptitude · General Intelligence and Reasoning · English Comprehension · General Awareness
            </span>
          </div>
        </div>

        {sourceTab === 'json' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
              <div className="sm:col-span-5">
                <label
                  htmlFor="json-default-shift"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Default Shift / Exam Tag (when <code className="font-mono">examShift</code> omitted)
                </label>
                <input
                  id="json-default-shift"
                  type="text"
                  value={shiftExamName}
                  onChange={(e) => setShiftExamName(e.target.value)}
                  disabled={isBusy}
                  placeholder="e.g. 14 July 2023 S1"
                  maxLength={40}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-7">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setJsonInputText(STRICT_JSON_SAMPLE);
                    setRowErrors([]);
                    setToast(null);
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Insert Sample Strict JSON
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => jsonFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Load .json File</span>
                </button>
                <input
                  ref={jsonFileInputRef}
                  type="file"
                  accept=".json,application/json,.txt"
                  className="hidden"
                  onChange={(e) => {
                    void handleSelectJsonFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="strict-json-textarea"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                PYQ JSON Array Payload (Strict 4-Subject Schema)
              </label>
              <textarea
                id="strict-json-textarea"
                rows={8}
                value={jsonInputText}
                onChange={(e) => setJsonInputText(e.target.value)}
                disabled={isBusy}
                placeholder='Paste JSON array with { examShift, subject, topic, questionEn, optionsEn, correctIndex, explanationEn }...'
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-[#11151d] p-3.5 font-mono text-xs text-slate-900 dark:text-slate-100 leading-relaxed"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Supports English-only or bilingual items. Topic Auto-Tagger validates each row&apos;s <code className="font-mono">topic</code> strictly against its <code className="font-mono">subject</code>.
              </p>
              <button
                type="button"
                disabled={!jsonInputText.trim() || isBusy}
                onClick={handleParseStrictJson}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap cursor-pointer transition-colors"
              >
                <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Parse &amp; Auto-Tag JSON</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Drag-and-Drop Zone */}
            <div className="lg:col-span-7">
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
                onClick={() => !isBusy && fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isBusy) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDF document for AI extraction"
                className={`flex min-h-[198px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
                  dragActive
                    ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/25'
                    : selectedFile
                      ? 'border-emerald-300 dark:border-emerald-700/70 bg-emerald-50/40 dark:bg-emerald-950/15'
                      : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-[#131720] hover:border-blue-500'
                } ${isBusy ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  data-testid="pdf-ingestor-file-input"
                  onChange={(e) => {
                    handleSelectPdf(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                  className="hidden"
                />

                {selectedFile ? (
                  <div className="space-y-2">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-200 dark:border-emerald-800 bg-[#faf9f6] dark:bg-[#181d27] text-emerald-700 dark:text-emerald-400">
                      <FileText className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 break-all">
                      {selectedFile.name}
                    </p>
                    <p className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatBytes(selectedFile.size)} · Ready for 5-page chunked extraction
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Replace PDF</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#181d27] text-blue-700 dark:text-blue-400">
                      <FileUp className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Drag &amp; drop a <span className="font-mono">.pdf</span> paper here, or click to browse
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Supports mixed full-shift papers (auto-classified into the 4 strict subjects) or single-subject PDFs.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata & Trigger */}
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#131720] p-5 lg:col-span-5">
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="pdf-shift-name"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Shift / Exam Name
                  </label>
                  <input
                    id="pdf-shift-name"
                    type="text"
                    value={shiftExamName}
                    onChange={(e) => setShiftExamName(e.target.value)}
                    disabled={isBusy}
                    placeholder="e.g. 14 July 2023 S1"
                    maxLength={40}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="pdf-subject-select"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Strict Subject Routing
                  </label>
                  <select
                    id="pdf-subject-select"
                    value={subjectMode}
                    onChange={(e) =>
                      setSubjectMode(e.target.value as 'auto' | StrictIngestSubjectName)
                    }
                    disabled={isBusy}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  >
                    <option value="auto">Auto-Detect (Strict 4-Subject Routing)</option>
                    {STRICT_INGEST_SUBJECT_NAMES.map((name) => (
                      <option key={name} value={name}>
                        Lock to: {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                disabled={!selectedFile || isBusy}
                onClick={() => void handleProcessWithAi()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap cursor-pointer transition-colors"
              >
                {progress.phase === 'parsing_pdf' || progress.phase === 'extracting_ai' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Processing PDF...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    <span>Process with AI</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Row Validation Errors */}
        {rowErrors.length > 0 && (
          <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 p-3.5 space-y-1 text-xs text-red-900 dark:text-red-200">
            <p className="font-semibold">
              Rejected {rowErrors.length} invalid row(s) during strict schema enforcement:
            </p>
            <ul className="list-disc pl-4 space-y-0.5 font-mono text-[11px]">
              {rowErrors.slice(0, 6).map((err, i) => (
                <li key={i}>{err.message}</li>
              ))}
              {rowErrors.length > 6 && (
                <li>...and {rowErrors.length - 6} additional row error(s).</li>
              )}
            </ul>
          </div>
        )}

        {/* Progress Indicator */}
        {isBusy && (
          <div className="rounded-xl border border-blue-200 dark:border-blue-800/60 bg-blue-50/70 dark:bg-blue-950/25 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-blue-950 dark:text-blue-200">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                <span>{progress.label}</span>
              </div>
              <span className="font-mono tabular-nums">{progressPct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-200/70 dark:bg-blue-900/50">
              <div
                className="h-full bg-blue-700 dark:bg-blue-400 transition-all duration-200"
                style={{ width: `${Math.max(4, progressPct)}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Preview Data Table */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Preview Data ({previewRows.length} ready)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verify Subject, Auto-Tagged Topic, Question preview, and Correct Answer to ensure zero cross-subject mixing before clicking Commit to Firestore.
              {skippedNotice > 0 ? ` (${skippedNotice} invalid row(s) rejected.)` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {previewRows.length > 0 && (
              <button
                type="button"
                disabled={isBusy}
                onClick={handleClearAllPreview}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear Preview</span>
              </button>
            )}
            <button
              type="button"
              disabled={previewRows.length === 0 || isBusy}
              onClick={() => void handleCommitToFirestore()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap cursor-pointer transition-colors"
            >
              {progress.phase === 'pushing_firestore' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Committing Batch...</span>
                </>
              ) : (
                <>
                  <Database className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Commit to Firestore ({previewRows.length})</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Strict Subject Verification Filter Bar */}
        {previewRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPreviewSubjectFilter('all')}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                  previewSubjectFilter === 'all'
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                All ({previewRows.length})
              </button>
              {STRICT_INGEST_SUBJECT_NAMES.map((subName) => (
                <button
                  key={subName}
                  type="button"
                  onClick={() => setPreviewSubjectFilter(subName)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                    previewSubjectFilter === subName
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {subName} ({subjectCounts[subName]})
                </button>
              ))}
            </div>
            {autoTaggedCount > 0 && (
              <span className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                Topic Auto-Tagger fixed {autoTaggedCount} row(s)
              </span>
            )}
          </div>
        )}

        {previewRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-[#131720] px-6 py-12 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              No parsed questions waiting for commit
            </p>
            <p className="mx-auto max-w-md text-xs text-slate-500 dark:text-slate-400">
              Paste a strict JSON PYQ array or extract a <span className="font-mono">.pdf</span> paper above to verify Subject, Topic, Question Preview, and Correct Answer before committing to Firestore.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[840px] border-collapse text-left text-xs">
              <thead className="bg-slate-50 dark:bg-[#131720] border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2.5 w-12">#</th>
                  <th className="px-3 py-2.5 w-52">Subject</th>
                  <th className="px-3 py-2.5 w-44">Topic</th>
                  <th className="px-3 py-2.5 min-w-[280px]">Question (Preview)</th>
                  <th className="px-3 py-2.5 min-w-[210px]">Correct Answer</th>
                  <th className="px-3 py-2.5 w-16 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredPreviewRows.map((row, idx) => {
                  const correctLetter = OPTION_LETTERS[row.correctIndex] ?? 'A';
                  const correctOptionText = row.optionsEn[row.correctIndex] ?? '';
                  return (
                    <tr
                      key={row.clientKey}
                      className="align-top hover:bg-slate-50/70 dark:hover:bg-[#1e2431]/50"
                    >
                      <td className="px-3 py-3 font-mono font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-3 space-y-1.5">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-snug ${SUBJECT_BADGE_CLASSES[row.strictSubject]}`}
                        >
                          {row.strictSubject}
                        </span>
                        <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                          {row.examShift}
                        </p>
                      </td>
                      <td className="px-3 py-3 space-y-1">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{row.topic}</p>
                        {row.autoTaggedFrom && (
                          <p className="font-mono text-[10px] text-amber-700 dark:text-amber-300">
                            Auto-tagged (was &ldquo;{row.autoTaggedFrom}&rdquo;)
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 space-y-1.5">
                        <p className="text-slate-900 dark:text-slate-100 whitespace-pre-line leading-relaxed line-clamp-4">
                          {row.questionEn}
                        </p>
                        {row.questionHi && (
                          <p className="text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                            {row.questionHi}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 space-y-1">
                        <div className="inline-flex items-start gap-1.5 rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 dark:text-emerald-200">
                          <span className="font-mono shrink-0">
                            {correctLetter} ({row.correctIndex}):
                          </span>
                          <span>{correctOptionText}</span>
                        </div>
                        {row.explanationEn && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                            {row.explanationEn}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemovePreviewRow(row.clientKey)}
                          aria-label={`Remove question ${idx + 1}`}
                          title="Remove row"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
