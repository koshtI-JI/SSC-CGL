import React, { useEffect, useState } from 'react';
import { Calculator, Delete, X } from 'lucide-react';
import {
  calcBackspace,
  calcClear,
  calcClearEntry,
  calcEquals,
  calcInputDecimal,
  calcInputDigit,
  calcInputOperator,
  calcUnaryOp,
  INITIAL_CALC_STATE,
  type CalcOperator,
  type CalcState,
} from '../utils/calculatorEngine';

interface ExamCalculatorProps {
  onClose: () => void;
}

export const ExamCalculator: React.FC<ExamCalculatorProps> = ({ onClose }) => {
  const [state, setState] = useState<CalcState>(INITIAL_CALC_STATE);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setState((s) => calcInputDigit(s, e.key));
      } else if (e.key === '.') {
        e.preventDefault();
        setState((s) => calcInputDecimal(s));
      } else if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
        e.preventDefault();
        setState((s) => calcInputOperator(s, e.key as CalcOperator));
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        setState((s) => calcEquals(s));
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setState((s) => calcBackspace(s));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside
      aria-label="Desktop Exam Calculator"
      className="hidden lg:flex fixed bottom-5 left-5 z-40 w-72 flex-col rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#131924] shadow-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#0f141d] px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
          <Calculator className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
          <span>TCS iON Calculator</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close calculator"
          className="rounded p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Display */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f17] px-4 py-3 text-right">
        <div className="min-h-[16px] font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
          {state.expression}
        </div>
        <div
          data-testid="calc-display"
          className="mt-0.5 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums truncate"
        >
          {state.display}
        </div>
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-4 gap-1.5 p-3">
        <button
          type="button"
          onClick={() => setState((s) => calcClearEntry(s))}
          className="rounded-lg bg-slate-100 dark:bg-[#222836] py-2 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
        >
          CE
        </button>
        <button
          type="button"
          onClick={() => setState(calcClear())}
          className="rounded-lg bg-red-50 dark:bg-red-950/40 py-2 font-mono text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 cursor-pointer"
        >
          C
        </button>
        <button
          type="button"
          onClick={() => setState((s) => calcBackspace(s))}
          aria-label="Backspace"
          className="flex items-center justify-center rounded-lg bg-slate-100 dark:bg-[#222836] py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
        >
          <Delete className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setState((s) => calcInputOperator(s, '/'))}
          className="rounded-lg bg-blue-50 dark:bg-blue-950/40 py-2 font-mono text-sm font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer"
        >
          ÷
        </button>

        <button
          type="button"
          onClick={() => setState((s) => calcUnaryOp(s, 'inv'))}
          className="rounded-lg bg-slate-100 dark:bg-[#222836] py-2 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
        >
          1/x
        </button>
        <button
          type="button"
          onClick={() => setState((s) => calcUnaryOp(s, 'sq'))}
          className="rounded-lg bg-slate-100 dark:bg-[#222836] py-2 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
        >
          x²
        </button>
        <button
          type="button"
          onClick={() => setState((s) => calcUnaryOp(s, 'sqrt'))}
          className="rounded-lg bg-slate-100 dark:bg-[#222836] py-2 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
        >
          √x
        </button>
        <button
          type="button"
          onClick={() => setState((s) => calcUnaryOp(s, 'pct'))}
          className="rounded-lg bg-slate-100 dark:bg-[#222836] py-2 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
        >
          %
        </button>

        {(['7', '8', '9'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setState((s) => calcInputDigit(s, d))}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] py-2 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setState((s) => calcInputOperator(s, '*'))}
          className="rounded-lg bg-blue-50 dark:bg-blue-950/40 py-2 font-mono text-sm font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer"
        >
          ×
        </button>

        {(['4', '5', '6'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setState((s) => calcInputDigit(s, d))}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] py-2 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setState((s) => calcInputOperator(s, '-'))}
          className="rounded-lg bg-blue-50 dark:bg-blue-950/40 py-2 font-mono text-sm font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer"
        >
          -
        </button>

        {(['1', '2', '3'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setState((s) => calcInputDigit(s, d))}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] py-2 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setState((s) => calcInputOperator(s, '+'))}
          className="rounded-lg bg-blue-50 dark:bg-blue-950/40 py-2 font-mono text-sm font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer"
        >
          +
        </button>

        <button
          type="button"
          onClick={() => setState((s) => calcUnaryOp(s, 'negate'))}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] py-2 font-mono text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
        >
          +/-
        </button>
        <button
          type="button"
          onClick={() => setState((s) => calcInputDigit(s, '0'))}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] py-2 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => setState((s) => calcInputDecimal(s))}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] py-2 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
        >
          .
        </button>
        <button
          type="button"
          onClick={() => setState((s) => calcEquals(s))}
          className="rounded-lg bg-blue-700 py-2 font-mono text-sm font-bold text-white hover:bg-blue-800 cursor-pointer"
        >
          =
        </button>
      </div>
    </aside>
  );
};
