export interface GithubRepoTarget {
  owner: string;
  repo: string;
  branch: string;
}

export interface GithubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface GithubFileContent {
  path: string;
  sha: string;
  content: string;
  size: number;
  htmlUrl?: string;
}

export interface GithubCommitResult {
  path: string;
  sha: string;
  commitSha: string;
  commitUrl?: string;
  branch: string;
}

export const PROTECTED_GIT_BRANCHES = new Set(['main', 'master']);
export const DEFAULT_GITHUB_TARGET: GithubRepoTarget = {
  owner: 'koshtI-JI',
  repo: 'SSC-CGL',
  branch: 'repair/path-to-cgl',
};

// Strictly in-memory token holder: NEVER persisted to localStorage, sessionStorage, IndexedDB, or Firestore.
let memoryGithubPat = '';

export function setMemoryGithubToken(token: string): void {
  memoryGithubPat = token.trim();
}

export function getMemoryGithubToken(): string {
  return memoryGithubPat;
}

export function clearMemoryGithubToken(): void {
  memoryGithubPat = '';
}

export function encodeUtf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function decodeBase64ToUtf8(base64: string): string {
  const clean = base64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function parseGithubRepoSlug(raw: string): { owner: string; repo: string } {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Repository must be in "owner/repo" format (e.g. koshtI-JI/SSC-CGL).');
  }
  return { owner: parts[0], repo: parts[1] };
}

export function isProtectedBranch(branch: string): boolean {
  return PROTECTED_GIT_BRANCHES.has(branch.trim().toLowerCase());
}

export function assertEditableGitBranch(branch: string): string {
  const trimmed = branch.trim();
  if (!trimmed) {
    throw new Error('Target branch name is required.');
  }
  if (isProtectedBranch(trimmed)) {
    throw new Error(
      `Direct commits to protected branch "${trimmed}" are blocked. Switch to a development branch (e.g. repair/path-to-cgl).`
    );
  }
  if (/[\s~^:?*[\]\\]/.test(trimmed)) {
    throw new Error(`Invalid Git branch name "${trimmed}".`);
  }
  return trimmed;
}

export function formatGithubApiError(status: number, bodyText: string, path?: string): string {
  let apiMessage = '';
  try {
    const parsed = JSON.parse(bodyText) as { message?: string };
    apiMessage = parsed?.message || '';
  } catch {
    apiMessage = bodyText.slice(0, 180);
  }

  if (status === 401) {
    return 'GitHub authentication failed (401). Check that your Personal Access Token is valid and not expired.';
  }
  if (status === 403) {
    return `GitHub access denied or rate-limited (403)${apiMessage ? `: ${apiMessage}` : ''}. Verify repo write permissions.`;
  }
  if (status === 404) {
    return `GitHub resource not found (404)${path ? ` for "${path}"` : ''}. Verify owner, repo, branch, and token scope.`;
  }
  if (status === 409) {
    return `GitHub file conflict (409)${path ? ` on "${path}"` : ''}: file changed remotely. Reload latest file before committing.`;
  }
  if (status === 422) {
    return `GitHub rejected request (422)${apiMessage ? `: ${apiMessage}` : ''}.`;
  }
  return `GitHub API error (${status})${apiMessage ? `: ${apiMessage}` : ''}`;
}

export function computeLineDiffSummary(originalText: string, modifiedText: string): {
  changed: boolean;
  addedLines: number;
  removedLines: number;
  totalLinesBefore: number;
  totalLinesAfter: number;
} {
  if (originalText === modifiedText) {
    const lineCount = originalText ? originalText.split('\n').length : 0;
    return {
      changed: false,
      addedLines: 0,
      removedLines: 0,
      totalLinesBefore: lineCount,
      totalLinesAfter: lineCount,
    };
  }
  const before = originalText.split('\n');
  const after = modifiedText.split('\n');
  const beforeCounts = new Map<string, number>();
  for (const line of before) {
    beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);
  }
  let matched = 0;
  for (const line of after) {
    const c = beforeCounts.get(line) ?? 0;
    if (c > 0) {
      beforeCounts.set(line, c - 1);
      matched += 1;
    }
  }
  return {
    changed: true,
    addedLines: Math.max(0, after.length - matched),
    removedLines: Math.max(0, before.length - matched),
    totalLinesBefore: before.length,
    totalLinesAfter: after.length,
  };
}

function buildGithubHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(extra ?? {}),
  };
  const trimmed = token.trim();
  if (trimmed) {
    headers.Authorization = `Bearer ${trimmed}`;
  }
  return headers;
}

function encodeRepoPathSegments(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export async function listRepoTree(
  target: GithubRepoTarget,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<GithubTreeItem[]> {
  const branchRef = encodeURIComponent(target.branch.trim() || 'repair/path-to-cgl');
  const url = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(
    target.repo
  )}/git/trees/${branchRef}?recursive=1`;
  const res = await fetchFn(url, {
    method: 'GET',
    headers: buildGithubHeaders(token),
  });
  if (!res.ok) {
    throw new Error(formatGithubApiError(res.status, await res.text()));
  }
  const data = (await res.json()) as {
    tree?: Array<{ path?: string; type?: string; sha?: string; size?: number }>;
  };
  return (data.tree ?? [])
    .filter((item) => item.path && item.type === 'blob' && item.sha)
    .map((item) => ({
      path: item.path!,
      type: 'blob' as const,
      sha: item.sha!,
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function fetchRepoFile(
  target: GithubRepoTarget,
  filePath: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<GithubFileContent> {
  const safePath = encodeRepoPathSegments(filePath);
  const url = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(
    target.repo
  )}/contents/${safePath}?ref=${encodeURIComponent(target.branch.trim())}`;
  const res = await fetchFn(url, {
    method: 'GET',
    headers: buildGithubHeaders(token),
  });
  if (!res.ok) {
    throw new Error(formatGithubApiError(res.status, await res.text(), filePath));
  }
  const data = (await res.json()) as {
    path: string;
    sha: string;
    content?: string;
    size?: number;
    html_url?: string;
    encoding?: string;
  };
  const decoded = data.content ? decodeBase64ToUtf8(data.content) : '';
  return {
    path: data.path || filePath,
    sha: data.sha,
    content: decoded,
    size: typeof data.size === 'number' ? data.size : decoded.length,
    ...(data.html_url ? { htmlUrl: data.html_url } : {}),
  };
}

export async function commitRepoFile(params: {
  target: GithubRepoTarget;
  filePath: string;
  content: string;
  commitMessage: string;
  token: string;
  expectedSha?: string;
  fetchFn?: typeof fetch;
}): Promise<GithubCommitResult> {
  const { target, filePath, content, commitMessage, token } = params;
  const fetchFn = params.fetchFn ?? fetch;
  const safeBranch = assertEditableGitBranch(target.branch);
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('A GitHub Personal Access Token (session-only) is required to commit changes.');
  }
  const cleanMessage = commitMessage.trim();
  if (cleanMessage.length < 3) {
    throw new Error('Please enter a commit message (at least 3 characters).');
  }

  // Always fetch latest SHA right before committing to prevent stale-SHA 409 overwrites.
  let latestSha = params.expectedSha;
  try {
    const latest = await fetchRepoFile(
      { ...target, branch: safeBranch },
      filePath,
      cleanToken,
      fetchFn
    );
    if (params.expectedSha && latest.sha !== params.expectedSha) {
      throw new Error(
        `Remote file "${filePath}" changed since you opened it. Reload the file to merge latest changes before committing.`
      );
    }
    latestSha = latest.sha;
  } catch (err) {
    // Allow creating a brand-new file if remote returned 404 and caller had no prior SHA
    const msg = err instanceof Error ? err.message : '';
    if (!msg.includes('(404)') || params.expectedSha) {
      throw err;
    }
    latestSha = undefined;
  }

  const safePath = encodeRepoPathSegments(filePath);
  const url = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(
    target.repo
  )}/contents/${safePath}`;

  const res = await fetchFn(url, {
    method: 'PUT',
    headers: buildGithubHeaders(cleanToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      message: cleanMessage,
      content: encodeUtf8ToBase64(content),
      branch: safeBranch,
      ...(latestSha ? { sha: latestSha } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(formatGithubApiError(res.status, await res.text(), filePath));
  }

  const payload = (await res.json()) as {
    content?: { path?: string; sha?: string };
    commit?: { sha?: string; html_url?: string };
  };

  return {
    path: payload.content?.path || filePath,
    sha: payload.content?.sha || '',
    commitSha: payload.commit?.sha || '',
    commitUrl: payload.commit?.html_url,
    branch: safeBranch,
  };
}
