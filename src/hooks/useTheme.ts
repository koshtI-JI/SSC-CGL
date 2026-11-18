import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'getcgl_theme_v1';
const THEME_CHANGE_EVENT = 'getcgl-theme-change';

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    return val === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyThemeClass(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  if (mode === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    applyThemeClass(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage access errors
    }
    window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: next }));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readStoredTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  useEffect(() => {
    applyThemeClass(readStoredTheme());
    const handleSync = (evt: Event) => {
      const custom = evt as CustomEvent<ThemeMode>;
      if (custom.detail === 'dark' || custom.detail === 'light') {
        setThemeState(custom.detail);
        applyThemeClass(custom.detail);
      } else {
        const latest = readStoredTheme();
        setThemeState(latest);
        applyThemeClass(latest);
      }
    };
    window.addEventListener(THEME_CHANGE_EVENT, handleSync);
    window.addEventListener('storage', handleSync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, []);

  return { theme, setTheme, toggleTheme };
}
