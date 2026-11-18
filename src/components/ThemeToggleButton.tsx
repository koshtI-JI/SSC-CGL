import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface ThemeToggleButtonProps {
  compact?: boolean;
  className?: string;
}

export const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({
  compact = false,
  className = '',
}) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to matte light mode' : 'Switch to matte dark mode'}
      aria-pressed={isDark}
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#f8f9fb] dark:bg-[#1e2533] px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${className}`}
    >
      {isDark ? (
        <Sun className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden="true" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-slate-700 shrink-0" aria-hidden="true" />
      )}
      {!compact && <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  );
};
