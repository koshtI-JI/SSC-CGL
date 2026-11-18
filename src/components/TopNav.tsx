import React from 'react';
import { ArrowLeft, BookOpenText, KeyRound, LogOut, Search } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { ThemeToggleButton } from './ThemeToggleButton';

export interface NavTabItem {
  id: string;
  label: string;
}

interface TopNavProps {
  tabs: NavTabItem[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  backButton?: { label: string; onClick: () => void } | null;
  notificationSlot?: React.ReactNode;
  onOpenGlobalSearch?: () => void;
  onOpenRules?: () => void;
  onOpenAiSettings?: () => void;
  onSignOut: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  tabs,
  activeTab,
  onSelectTab,
  backButton,
  notificationSlot,
  onOpenGlobalSearch,
  onOpenRules,
  onOpenAiSettings,
  onSignOut,
}) => {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800/80 bg-[#faf9f6]/95 dark:bg-[#0f141d]/95 backdrop-blur-xs transition-colors">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 sm:gap-4 px-2.5 py-2.5 sm:px-6 sm:py-3">
        {/* Zone 1: Brand Wordmark (+ optional contextual back action) */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink-0">
          {backButton && (
            <button
              type="button"
              onClick={backButton.onClick}
              className="inline-flex min-h-[34px] sm:min-h-[36px] items-center gap-1 sm:gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#18202c] px-2 sm:px-2.5 py-1 sm:py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="max-w-[54px] truncate sm:max-w-none">{backButton.label}</span>
            </button>
          )}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              onSelectTab(tabs[0]?.id ?? 'overview');
            }}
            className="font-display text-[15px] sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            Path to CGL
          </a>
        </div>

        {/* Zone 2: Clean Navigation Links (wraps gracefully when Admin has 8+ tabs so none clip off-screen) */}
        <nav
          aria-label="Primary navigation"
          className="hidden lg:flex items-center min-w-0 flex-1 px-1"
        >
          <div
            className={`mx-auto flex items-center ${
              tabs.length > 7
                ? 'flex-wrap justify-center gap-x-3 gap-y-1'
                : 'gap-3 xl:gap-4 overflow-x-auto no-scrollbar'
            }`}
          >
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`relative py-1 text-xs xl:text-[13px] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'font-semibold text-blue-700 dark:text-blue-400'
                      : 'font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span>{tab.label}</span>
                  {active && (
                    <span
                      aria-hidden="true"
                      className={`absolute inset-x-0 h-0.5 bg-blue-700 dark:bg-blue-400 ${
                        tabs.length > 7 ? '-bottom-0.5' : '-bottom-[13px]'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Zone 3: Utility & Primary Session Action */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {onOpenGlobalSearch && (
            <button
              type="button"
              onClick={onOpenGlobalSearch}
              aria-label="Global Search"
              title="Search Mocks, Syllabus & Vault"
              className="inline-flex min-h-[34px] sm:min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#131924] px-2 sm:px-2.5 py-1 sm:py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Search className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300 shrink-0" aria-hidden="true" />
              <span className="hidden xl:inline">Search</span>
            </button>
          )}
          {onOpenRules && (
            <button
              type="button"
              onClick={onOpenRules}
              aria-label="Rules and XP Guidelines"
              title="Rules & XP Guidelines"
              className="inline-flex min-h-[34px] sm:min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#131924] px-2 sm:px-2.5 py-1 sm:py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BookOpenText className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
              <span className="hidden xl:inline">Rules</span>
            </button>
          )}
          {onOpenAiSettings && (
            <button
              type="button"
              onClick={onOpenAiSettings}
              aria-label="AI Key and Multi-Provider LLM Engine Settings"
              title="AI Key & Multi-Provider LLM Engine Config"
              className="inline-flex min-h-[34px] sm:min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#131924] px-2 sm:px-2.5 py-1 sm:py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden="true" />
              <span className="hidden xl:inline">AI Key</span>
            </button>
          )}
          <ThemeToggleButton compact />
          {notificationSlot}
          <PWAInstallButton />
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign Out"
            className="inline-flex min-h-[34px] sm:min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-[#faf9f6] dark:bg-[#131924] px-2 sm:px-3 py-1 sm:py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>

      {/* Compact Mobile / Tablet Horizontal Tab Strip */}
      <nav
        aria-label="Mobile navigation"
        className="flex lg:hidden items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-slate-100 dark:border-slate-800/80 px-3 py-1.5 sm:px-6"
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`min-h-[34px] text-xs font-semibold whitespace-nowrap shrink-0 px-3 py-1 rounded-md transition-colors cursor-pointer ${
                active
                  ? 'bg-blue-700 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
