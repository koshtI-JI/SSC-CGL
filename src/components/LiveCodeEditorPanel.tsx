import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Eye,
  EyeOff,
  FileCode2,
  FolderGit2,
  GitBranch,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  assertEditableGitBranch,
  clearMemoryGithubToken,
  commitRepoFile,
  computeLineDiffSummary,
  DEFAULT_GITHUB_TARGET,
  fetchRepoFile,
  getMemoryGithubToken,
  isProtectedBranch,
  listRepoTree,
  parseGithubRepoSlug,
  publishComingSoonToGhPages,
  setMemoryGithubToken,
  type GithubTreeItem,
} from '../utils/githubCodeEditor';

interface LiveCodeEditorPanelProps {
  onNotify?: (type: 'ok' | 'err', text: string) => void;
}

export const LiveCodeEditorPanel: React.FC<LiveCodeEditorPanelProps> = ({ onNotify }) => {
  const [repoSlug, setRepoSlug] = useState(
    `${DEFAULT_GITHUB_TARGET.owner}/${DEFAULT_GITHUB_TARGET.repo}`
  );
  const [branch, setBranch] = useState(DEFAULT_GITHUB_TARGET.branch);
  const [token, setToken] = useState(() => getMemoryGithubToken());
  const [showToken, setShowToken] = useState(false);

  const [treeItems, setTreeItems] = useState<GithubTreeItem[]>([]);
  const [treeFilter, setTreeFilter] = useState('');
  const [loadingTree, setLoadingTree] = useState(false);

  const [selectedPath, setSelectedPath] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [fileSha, setFileSha] = useState<string>('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [publishingPages, setPublishingPages] = useState(false);
  const [editorView, setEditorView] = useState<'edit' | 'preview'>('edit');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Sync in-memory session token (never persisted to storage) and wipe cleanly when Admin leaves.
  const handleTokenChange = (nextVal: string) => {
    setToken(nextVal);
    setMemoryGithubToken(nextVal);
  };

  const handleClearToken = () => {
    clearMemoryGithubToken();
    setToken('');
    setFeedback({
      type: 'ok',
      text: 'Cleared in-memory GitHub token. Nothing was written to browser storage.',
    });
  };

  useEffect(() => {
    return () => {
      // Wipe token automatically on panel unmount or admin navigation away for security
      clearMemoryGithubToken();
    };
  }, []);

  const report = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    onNotify?.(type, text);
  };

  const filteredTree = useMemo(() => {
    const q = treeFilter.trim().toLowerCase();
    const list = q
      ? treeItems.filter((item) => item.path.toLowerCase().includes(q))
      : treeItems;
    return list.slice(0, 200);
  }, [treeItems, treeFilter]);

  const diffSummary = useMemo(
    () => computeLineDiffSummary(originalContent, editorContent),
    [originalContent, editorContent]
  );

  const isMainBlocked = isProtectedBranch(branch);

  const handleLoadTree = async () => {
    setLoadingTree(true);
    setFeedback(null);
    try {
      const { owner, repo } = parseGithubRepoSlug(repoSlug);
      const items = await listRepoTree(
        { owner, repo, branch: branch.trim() || DEFAULT_GITHUB_TARGET.branch },
        token
      );
      setTreeItems(items);
      report('ok', `Loaded ${items.length} files from ${owner}/${repo}@${branch.trim()}.`);
    } catch (err) {
      report('err', err instanceof Error ? err.message : 'Unable to fetch repository file tree.');
    } finally {
      setLoadingTree(false);
    }
  };

  const handleOpenFile = async (path: string) => {
    setLoadingFile(true);
    setFeedback(null);
    try {
      const { owner, repo } = parseGithubRepoSlug(repoSlug);
      const loaded = await fetchRepoFile(
        { owner, repo, branch: branch.trim() || DEFAULT_GITHUB_TARGET.branch },
        path,
        token
      );
      setSelectedPath(loaded.path);
      setOriginalContent(loaded.content);
      setEditorContent(loaded.content);
      setFileSha(loaded.sha);
      setCommitMessage(`chore(cms): update ${loaded.path}`);
    } catch (err) {
      report('err', err instanceof Error ? err.message : `Unable to load "${path}".`);
    } finally {
      setLoadingFile(false);
    }
  };

  const handleCommitFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPath) return;
    setCommitting(true);
    setFeedback(null);
    try {
      const safeBranch = assertEditableGitBranch(branch);
      const { owner, repo } = parseGithubRepoSlug(repoSlug);
      const result = await commitRepoFile({
        target: { owner, repo, branch: safeBranch },
        filePath: selectedPath,
        content: editorContent,
        commitMessage,
        token,
        expectedSha: fileSha || undefined,
      });
      setOriginalContent(editorContent);
      setFileSha(result.sha || fileSha);
      report(
        'ok',
        `Committed "${result.path}" to ${safeBranch} (${result.commitSha.slice(0, 7) || 'ok'}).`
      );
    } catch (err) {
      report('err', err instanceof Error ? err.message : 'Commit failed.');
    } finally {
      setCommitting(false);
    }
  };

  const handlePublishComingSoonToGhPages = async () => {
    setPublishingPages(true);
    setFeedback(null);
    try {
      const { owner, repo } = parseGithubRepoSlug(repoSlug);
      const results = await publishComingSoonToGhPages({
        owner,
        repo,
        token,
        branch: 'gh-pages',
      });
      report(
        'ok',
        `Published ${results.map((r) => r.path).join(', ')} to ${owner}/${repo}@gh-pages. Live GitHub Pages updates in 1–2 minutes.`
      );
    } catch (err) {
      report(
        'err',
        err instanceof Error ? err.message : 'Unable to publish Coming Soon page to gh-pages.'
      );
    } finally {
      setPublishingPages(false);
    }
  };

  const previewLines = useMemo(() => editorContent.split('\n').slice(0, 500), [editorContent]);

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#faf9f6] dark:bg-[#181d27] p-6 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
            <FolderGit2 className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>GitHub CMS &amp; Live Code Editor</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Browse repository files, inspect changes, and commit safely to development branches. Protected branches (<code className="font-mono">main</code>/<code className="font-mono">master</code>) are blocked.
          </p>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 shrink-0">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Memory-Only Token (Zero Storage)</span>
        </span>
      </div>

      {/* Repo / Branch / Memory-Only PAT Bar */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="md:col-span-4">
          <label htmlFor="gh-repo" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Repository (owner/repo)
          </label>
          <input
            id="gh-repo"
            type="text"
            value={repoSlug}
            onChange={(e) => setRepoSlug(e.target.value)}
            placeholder="koshtI-JI/SSC-CGL"
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="md:col-span-3">
          <label
            htmlFor="gh-branch"
            className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            <GitBranch className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>Branch</span>
          </label>
          <input
            id="gh-branch"
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="repair/path-to-cgl"
            className={`mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs ${
              isMainBlocked
                ? 'border-red-400 bg-red-50/60 dark:bg-red-950/20 text-red-900 dark:text-red-200'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] text-slate-900 dark:text-slate-100'
            }`}
          />
        </div>

        <div className="md:col-span-5">
          <label
            htmlFor="gh-pat"
            className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            <KeyRound className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
            <span>GitHub Personal Access Token (Session Memory Only)</span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                id="gh-pat"
                type={showToken ? 'text' : 'password'}
                autoComplete="off"
                value={token}
                onChange={(e) => handleTokenChange(e.target.value)}
                placeholder="ghp_... (never saved to storage)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] pl-3 pr-9 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                aria-label={showToken ? 'Hide GitHub token' : 'Show GitHub token'}
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {token && (
              <button
                type="button"
                onClick={handleClearToken}
                title="Wipe PAT from session memory"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#131720] px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear</span>
              </button>
            )}
            <button
              type="button"
              disabled={loadingTree}
              onClick={() => void handleLoadTree()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingTree ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{loadingTree ? 'Loading...' : 'Load Files'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 1-Click GitHub Pages Coming Soon Deploy */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/25 px-4 py-3">
        <div className="text-xs text-slate-700 dark:text-slate-200">
          <strong className="font-semibold text-slate-900 dark:text-white">
            One-Click GitHub Pages Coming Soon Publish:
          </strong>{' '}
          Pushes the clean Coming Soon <code className="font-mono">index.html</code>,{' '}
          <code className="font-mono">404.html</code>, and cache-clearing{' '}
          <code className="font-mono">sw.js</code> directly to <code className="font-mono">gh-pages</code>.
        </div>
        <button
          type="button"
          disabled={publishingPages || !token.trim()}
          onClick={() => void handlePublishComingSoonToGhPages()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1e3a8a] hover:bg-blue-800 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50 whitespace-nowrap cursor-pointer shrink-0"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{publishingPages ? 'Publishing to gh-pages...' : 'Publish Coming Soon to gh-pages'}</span>
        </button>
      </div>

      {isMainBlocked && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/35 px-3.5 py-2.5 text-xs text-red-900 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Branch protection active: commits to <strong>{branch}</strong> are blocked. Switch to{' '}
            <code className="font-mono font-bold">repair/path-to-cgl</code> or a feature branch before committing.
          </span>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs font-medium ${
            feedback.type === 'ok'
              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/35 text-emerald-900 dark:text-emerald-200'
              : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/35 text-red-900 dark:text-red-200'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Main Split Tree + Code Editor */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Repository File Browser */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131720] p-3 space-y-3 lg:col-span-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Filter repository files"
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
              placeholder="Filter path (e.g. src/, reports/)..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#11151d] pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
            {treeItems.length === 0 ? (
              <p className="py-10 px-3 text-center text-xs text-slate-500 dark:text-slate-400">
                Click <strong>Load Files</strong> above to browse <code className="font-mono">{repoSlug}</code>.
              </p>
            ) : filteredTree.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No files match &ldquo;{treeFilter}&rdquo;.
              </p>
            ) : (
              filteredTree.map((item) => {
                const active = item.path === selectedPath;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => void handleOpenFile(item.path)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-mono transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 font-bold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1a202c]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                      <span className="truncate">{item.path}</span>
                    </span>
                    {typeof item.size === 'number' && (
                      <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                        {item.size < 1024 ? `${item.size}B` : `${(item.size / 1024).toFixed(1)}K`}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Editor / Syntax-Numbered Preview & Commit Form */}
        <form
          onSubmit={handleCommitFile}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131720] p-4 space-y-3 lg:col-span-8 flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Code2 className="h-4 w-4 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
                <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                  {selectedPath || 'Select a file to inspect or edit'}
                </span>
                {diffSummary.changed && (
                  <span className="rounded bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-900 dark:text-amber-300">
                    +{diffSummary.addedLines} / -{diffSummary.removedLines} unsaved
                  </span>
                )}
              </div>

              {selectedPath && (
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setEditorView('edit')}
                      className={`px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                        editorView === 'edit'
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-50 dark:bg-[#1e2431] text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorView('preview')}
                      className={`px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                        editorView === 'preview'
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-50 dark:bg-[#1e2431] text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Line View
                    </button>
                  </div>
                  {diffSummary.changed && (
                    <button
                      type="button"
                      onClick={() => setEditorContent(originalContent)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      <span>Revert</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {loadingFile ? (
              <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
                Loading file from GitHub...
              </div>
            ) : !selectedPath ? (
              <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
                Choose a repository file on the left to inspect its contents or commit a patch to{' '}
                <code className="font-mono">{branch}</code>.
              </div>
            ) : editorView === 'edit' ? (
              <textarea
                aria-label={`Code editor for ${selectedPath}`}
                rows={16}
                spellCheck={false}
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0f131b] p-3 font-mono text-xs leading-relaxed text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            ) : (
              <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                {previewLines.map((line, i) => (
                  <div key={i} className="flex gap-3 whitespace-pre">
                    <span className="w-8 shrink-0 select-none text-right text-slate-500 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-slate-100">{line || ' '}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedPath && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center border-t border-slate-200 dark:border-slate-800 pt-3">
              <input
                type="text"
                aria-label="Commit message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message (e.g. fix: update question schema)"
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={committing || isMainBlocked || !diffSummary.changed}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{committing ? 'Committing...' : `Commit to ${branch}`}</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </section>
  );
};
