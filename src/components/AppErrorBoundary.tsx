import React from 'react';
import { RotateCcw } from 'lucide-react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
  sectionName?: string;
  onReset?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected workspace interruption',
    };
  }

  componentDidCatch(error: Error) {
    // Preserve session & in-progress exam drafts in localStorage/IndexedDB; avoid noisy crashes
    void error;
  }

  private handleRecoverSection = () => {
    this.setState({ hasError: false, message: '' });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      const label = this.props.sectionName || 'Workspace';
      return (
        <div className="flex min-h-[60vh] items-center justify-center bg-slate-50 dark:bg-[#0b0f17] p-6">
          <div className="max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-6 text-center space-y-4 shadow-sm">
            <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {label} Auto-Recovery
            </h1>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              A temporary UI error occurred ({this.state.message}). Your session and any in-progress test answers are safely saved locally.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {this.props.sectionName && (
                <button
                  type="button"
                  onClick={this.handleRecoverSection}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#18202c] px-4 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <span>Recover {this.props.sectionName}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Reload Workspace</span>
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
