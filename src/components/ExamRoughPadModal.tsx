import React, { useEffect, useRef, useState } from 'react';
import { Eraser, PenTool, Trash2, X } from 'lucide-react';

interface ExamRoughPadModalProps {
  notes: string;
  onChangeNotes: (next: string) => void;
  onClose: () => void;
}

export const ExamRoughPadModal: React.FC<ExamRoughPadModalProps> = ({
  notes,
  onChangeNotes,
  onClose,
}) => {
  const [mode, setMode] = useState<'draw' | 'notes'>('draw');
  const [penMode, setPenMode] = useState<'pen' | 'eraser'>('pen');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const getPointerCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getPointerCoords(e);
    drawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { x, y } = getPointerCoords(e);
    ctx.globalCompositeOperation = penMode === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = penMode === 'eraser' ? 18 : 2.5;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
  };

  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rough-pad-title"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#181d27] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <div>
            <h2 id="rough-pad-title" className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Exam Rough Sheet &amp; Calculation Pad
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Draw Geometry / Venn / DI sketches or jot down quick calculations without leaving your exam.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close Rough Pad"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-5 py-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMode('draw')}
              className={`rounded-md px-3 py-1 text-xs font-semibold cursor-pointer ${
                mode === 'draw'
                  ? 'bg-blue-700 text-white'
                  : 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] text-slate-700 dark:text-slate-200'
              }`}
            >
              Sketch Canvas
            </button>
            <button
              type="button"
              onClick={() => setMode('notes')}
              className={`rounded-md px-3 py-1 text-xs font-semibold cursor-pointer ${
                mode === 'notes'
                  ? 'bg-blue-700 text-white'
                  : 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] text-slate-700 dark:text-slate-200'
              }`}
            >
              Quick Number Notes
            </button>
          </div>

          {mode === 'draw' ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPenMode('pen')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  penMode === 'pen'
                    ? 'bg-slate-900 dark:bg-blue-700 text-white'
                    : 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] text-slate-700 dark:text-slate-200'
                }`}
              >
                <PenTool className="h-3 w-3" aria-hidden="true" />
                <span>Pen</span>
              </button>
              <button
                type="button"
                onClick={() => setPenMode('eraser')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  penMode === 'eraser'
                    ? 'bg-slate-900 dark:bg-blue-700 text-white'
                    : 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1e2431] text-slate-700 dark:text-slate-200'
                }`}
              >
                <Eraser className="h-3 w-3" aria-hidden="true" />
                <span>Eraser</span>
              </button>
              <button
                type="button"
                onClick={handleClearCanvas}
                className="inline-flex items-center gap-1 rounded-md border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-2.5 py-1 text-xs font-semibold text-red-800 dark:text-red-300 hover:bg-red-100 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                <span>Clear</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onChangeNotes('')}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-2.5 py-1 text-xs font-semibold text-red-800 dark:text-red-300 hover:bg-red-100 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              <span>Clear Notes</span>
            </button>
          )}
        </div>

        <div className="p-4">
          <div className={mode === 'draw' ? 'block' : 'hidden'}>
            <canvas
              ref={canvasRef}
              width={720}
              height={340}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="w-full h-72 rounded-xl border border-slate-300 dark:border-slate-700 bg-[#fcfcfd] touch-none cursor-crosshair"
            />
          </div>
          {mode === 'notes' && (
            <textarea
              value={notes}
              onChange={(e) => onChangeNotes(e.target.value)}
              rows={11}
              placeholder="Write intermediate calculations, ratios, seating order, or option eliminations here..."
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] p-3.5 font-mono text-sm text-slate-900 dark:text-slate-100 focus:border-blue-700 focus:outline-none"
            />
          )}
        </div>
      </div>
    </div>
  );
};
