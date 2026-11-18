import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNavigationUrl,
  resolveAppRoute,
  stripBasePath,
} from './appRoutes';

test('stripBasePath removes configured Vite base path cleanly', () => {
  assert.equal(stripBasePath('/SSC-CGL/', '/SSC-CGL/'), '/');
  assert.equal(stripBasePath('/SSC-CGL/om', '/SSC-CGL/'), '/om');
  assert.equal(stripBasePath('/SSC-CGL/dest-simulator/', '/SSC-CGL/'), '/dest-simulator');
  assert.equal(stripBasePath('/om', '/'), '/om');
});

test('resolveAppRoute prioritizes hash routes for GitHub Pages reliability', () => {
  assert.equal(
    resolveAppRoute({ pathname: '/SSC-CGL/', hash: '#/om', baseUrl: '/SSC-CGL/' }),
    '/om'
  );
  assert.equal(
    resolveAppRoute({
      pathname: '/SSC-CGL/',
      hash: '#/dest-simulator',
      baseUrl: '/SSC-CGL/',
    }),
    '/dest-simulator'
  );
  assert.equal(
    resolveAppRoute({ pathname: '/SSC-CGL/om', hash: '#/', baseUrl: '/SSC-CGL/' }),
    '/'
  );
});

test('resolveAppRoute handles direct subpaths and 404.html ?p= redirects', () => {
  assert.equal(
    resolveAppRoute({ pathname: '/SSC-CGL/om', baseUrl: '/SSC-CGL/' }),
    '/om'
  );
  assert.equal(
    resolveAppRoute({ pathname: '/SSC-CGL/', search: '?p=/dest-simulator', baseUrl: '/SSC-CGL/' }),
    '/dest-simulator'
  );
  assert.equal(
    resolveAppRoute({ pathname: '/unknown-page', baseUrl: '/' }),
    '/'
  );
});

test('buildNavigationUrl preserves Vite base path with hash route', () => {
  assert.equal(buildNavigationUrl('/', '/'), '/#/');
  assert.equal(buildNavigationUrl('/om', '/SSC-CGL/'), '/SSC-CGL/#/om');
  assert.equal(buildNavigationUrl('/dest-simulator', '/SSC-CGL'), '/SSC-CGL/#/dest-simulator');
  assert.equal(buildNavigationUrl('/', '/SSC-CGL/'), '/SSC-CGL/#/');
});
