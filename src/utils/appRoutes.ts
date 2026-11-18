export type AppRoutePath = '/' | '/om' | '/dest-simulator';

function normalizeLeadingSlash(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, '');
  if (!cleaned) return '/';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

export function stripBasePath(pathname: string, baseUrl: string = '/'): string {
  const cleanPath = normalizeLeadingSlash(pathname || '/');
  const cleanBase = normalizeLeadingSlash(baseUrl || '/');
  if (cleanBase !== '/' && (cleanPath === cleanBase || cleanPath.startsWith(`${cleanBase}/`))) {
    const rest = cleanPath.slice(cleanBase.length);
    return rest ? normalizeLeadingSlash(rest) : '/';
  }
  return cleanPath;
}

export function resolveAppRoute(loc: {
  pathname?: string;
  hash?: string;
  search?: string;
  baseUrl?: string;
}): AppRoutePath {
  const hash = (loc.hash || '').trim();
  if (hash.startsWith('#/')) {
    const hashPath = normalizeLeadingSlash(hash.slice(1).split('?')[0]);
    if (hashPath === '/om' || hashPath.endsWith('/om')) return '/om';
    if (hashPath === '/dest-simulator' || hashPath.endsWith('/dest-simulator')) {
      return '/dest-simulator';
    }
    if (hashPath === '/') return '/';
  }

  if (loc.search) {
    try {
      const params = new URLSearchParams(loc.search);
      const redirected = params.get('p');
      if (redirected) {
        const cleanRedirect = normalizeLeadingSlash(redirected);
        if (cleanRedirect === '/om' || cleanRedirect.endsWith('/om')) return '/om';
        if (cleanRedirect === '/dest-simulator' || cleanRedirect.endsWith('/dest-simulator')) {
          return '/dest-simulator';
        }
      }
    } catch {
      // Ignore malformed search query
    }
  }

  const relativePath = stripBasePath(loc.pathname || '/', loc.baseUrl || '/');
  if (relativePath === '/om' || relativePath.endsWith('/om')) return '/om';
  if (relativePath === '/dest-simulator' || relativePath.endsWith('/dest-simulator')) {
    return '/dest-simulator';
  }
  return '/';
}

export function isOmRoutePath(route: AppRoutePath | string): boolean {
  return resolveAppRoute({ pathname: route, hash: route.startsWith('#') ? route : undefined }) === '/om';
}

export function isDestRoutePath(route: AppRoutePath | string): boolean {
  return (
    resolveAppRoute({ pathname: route, hash: route.startsWith('#') ? route : undefined }) ===
    '/dest-simulator'
  );
}

/**
 * Builds a GitHub-Pages-safe hash URL (`#/om`, `#/dest-simulator`, `#/`)
 * anchored at the Vite `BASE_URL` so subpath deployments like `/SSC-CGL/`
 * never lose their base prefix or trigger 404s on refresh.
 */
export function buildNavigationUrl(targetRoute: AppRoutePath, baseUrl: string = '/'): string {
  const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  if (targetRoute === '/') {
    return `${cleanBase}#/`;
  }
  return `${cleanBase}#${targetRoute}`;
}
