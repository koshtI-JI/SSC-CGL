import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertEditableGitBranch,
  clearMemoryGithubToken,
  commitRepoFile,
  computeLineDiffSummary,
  decodeBase64ToUtf8,
  encodeUtf8ToBase64,
  formatGithubApiError,
  getMemoryGithubToken,
  isProtectedBranch,
  parseGithubRepoSlug,
  setMemoryGithubToken,
} from './githubCodeEditor';

test('encodeUtf8ToBase64 & decodeBase64ToUtf8 preserve Hindi Devanagari, symbols, and TypeScript cleanly', () => {
  const sample = [
    '// Path to CGL — Bilingual Sample',
    'export const prompt = "यदि sin θ = 3/5 है, तो tan θ क्या होगा? ✓";',
  ].join('\n');

  const encoded = encodeUtf8ToBase64(sample);
  const decoded = decodeBase64ToUtf8(encoded);
  assert.equal(decoded, sample);
});

test('assertEditableGitBranch blocks protected branches main/master and allows dev branches', () => {
  assert.equal(isProtectedBranch('main'), true);
  assert.equal(isProtectedBranch('MAIN'), true);
  assert.equal(isProtectedBranch('master'), true);
  assert.equal(isProtectedBranch('repair/path-to-cgl'), false);

  assert.throws(() => assertEditableGitBranch('main'), /blocked/i);
  assert.throws(() => assertEditableGitBranch('master'), /blocked/i);
  assert.equal(assertEditableGitBranch('repair/path-to-cgl'), 'repair/path-to-cgl');
});

test('parseGithubRepoSlug parses full URLs and owner/repo slugs accurately', () => {
  assert.deepEqual(parseGithubRepoSlug('koshtI-JI/SSC-CGL'), {
    owner: 'koshtI-JI',
    repo: 'SSC-CGL',
  });
  assert.deepEqual(parseGithubRepoSlug('https://github.com/koshtI-JI/SSC-CGL.git'), {
    owner: 'koshtI-JI',
    repo: 'SSC-CGL',
  });
  assert.throws(() => parseGithubRepoSlug('invalid-slug'), /owner\/repo/i);
});

test('memory-only GitHub PAT store clears cleanly without writing to browser storage', () => {
  clearMemoryGithubToken();
  assert.equal(getMemoryGithubToken(), '');
  setMemoryGithubToken('ghp_test_session_only_123');
  assert.equal(getMemoryGithubToken(), 'ghp_test_session_only_123');
  clearMemoryGithubToken();
  assert.equal(getMemoryGithubToken(), '');
});

test('commitRepoFile verifies latest SHA, blocks main branch, and sends UTF-8 Base64 PUT', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    if (method === 'GET') {
      return new Response(
        JSON.stringify({
          path: 'README.md',
          sha: 'sha_latest_123',
          content: encodeUtf8ToBase64('old content'),
          size: 11,
        }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify({
        content: { path: 'README.md', sha: 'sha_new_456' },
        commit: { sha: 'commit_abc', html_url: 'https://github.com/koshtI-JI/SSC-CGL/commit/commit_abc' },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  await assert.rejects(
    commitRepoFile({
      target: { owner: 'koshtI-JI', repo: 'SSC-CGL', branch: 'main' },
      filePath: 'README.md',
      content: 'hi',
      commitMessage: 'Should fail on main',
      token: 'ghp_123456',
      fetchFn: fakeFetch,
    }),
    /protected branch/i
  );

  // Stale SHA rejection before PUT
  await assert.rejects(
    commitRepoFile({
      target: { owner: 'koshtI-JI', repo: 'SSC-CGL', branch: 'repair/path-to-cgl' },
      filePath: 'README.md',
      content: 'updated',
      commitMessage: 'Test stale check',
      token: 'ghp_123456',
      expectedSha: 'sha_old_000',
      fetchFn: fakeFetch,
    }),
    /changed since you opened it/i
  );

  const result = await commitRepoFile({
    target: { owner: 'koshtI-JI', repo: 'SSC-CGL', branch: 'repair/path-to-cgl' },
    filePath: 'README.md',
    content: 'हिन्दी + English Updated',
    commitMessage: 'chore: update bilingual README',
    token: 'ghp_123456',
    expectedSha: 'sha_latest_123',
    fetchFn: fakeFetch,
  });

  assert.equal(result.sha, 'sha_new_456');
  assert.equal(result.commitSha, 'commit_abc');
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.ok(putCall?.body);
  const putPayload = JSON.parse(putCall.body) as { branch: string; sha: string; content: string };
  assert.equal(putPayload.branch, 'repair/path-to-cgl');
  assert.equal(putPayload.sha, 'sha_latest_123');
  assert.equal(decodeBase64ToUtf8(putPayload.content), 'हिन्दी + English Updated');
});

test('formatGithubApiError and computeLineDiffSummary produce accurate diagnostics', () => {
  assert.match(formatGithubApiError(401, '{}'), /authentication failed/i);
  assert.match(formatGithubApiError(409, '{}', 'src/App.tsx'), /conflict/i);

  const diff = computeLineDiffSummary('a\nb\nc', 'a\nb2\nc\nd');
  assert.equal(diff.changed, true);
  assert.equal(diff.addedLines, 2);
  assert.equal(diff.removedLines, 1);
});
