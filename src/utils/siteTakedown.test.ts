import assert from 'node:assert/strict';
import test from 'node:test';
import { KNOWN_INDEXED_DB_NAMES, wipeClientOfflineState } from './siteTakedown';

test('wipeClientOfflineState unregisters SWs, deletes caches, clears storages, and removes all IndexedDBs', async () => {
  let localCleared = false;
  let sessionCleared = false;
  const unregisteredIds: string[] = [];
  const deletedCaches: string[] = [];
  const deletedDbs: string[] = [];

  const summary = await wipeClientOfflineState({
    localStorage: {
      clear() {
        localCleared = true;
      },
    },
    sessionStorage: {
      clear() {
        sessionCleared = true;
      },
    },
    serviceWorker: {
      async getRegistrations() {
        return [
          {
            async unregister() {
              unregisteredIds.push('sw-1');
              return true;
            },
          },
          {
            async unregister() {
              unregisteredIds.push('sw-2');
              return true;
            },
          },
        ];
      },
    },
    caches: {
      async keys() {
        return ['workbox-precache-v2', 'google-fonts-cache'];
      },
      async delete(name: string) {
        deletedCaches.push(name);
        return true;
      },
    },
    indexedDB: {
      async databases() {
        return [{ name: 'path_to_cgl_idb_v1' }, { name: 'firestore/custom/db' }];
      },
      deleteDatabase(name: string) {
        deletedDbs.push(name);
      },
    },
  });

  assert.equal(localCleared, true);
  assert.equal(sessionCleared, true);
  assert.equal(summary.localStorageCleared, true);
  assert.equal(summary.sessionStorageCleared, true);
  assert.equal(summary.serviceWorkersUnregistered, 2);
  assert.deepEqual(unregisteredIds, ['sw-1', 'sw-2']);
  assert.equal(summary.cachesDeleted, 2);
  assert.deepEqual(deletedCaches, ['workbox-precache-v2', 'google-fonts-cache']);
  assert.equal(deletedDbs.includes('path_to_cgl_idb_v1'), true);
  assert.equal(deletedDbs.includes('firestore/custom/db'), true);
  assert.equal(summary.indexedDbsRequested, KNOWN_INDEXED_DB_NAMES.length + 1);
});

test('wipeClientOfflineState handles missing browser APIs gracefully without throwing', async () => {
  const summary = await wipeClientOfflineState({
    localStorage: null,
    sessionStorage: null,
    serviceWorker: null,
    caches: null,
    indexedDB: null,
  });

  assert.deepEqual(summary, {
    serviceWorkersUnregistered: 0,
    cachesDeleted: 0,
    indexedDbsRequested: 0,
    localStorageCleared: false,
    sessionStorageCleared: false,
  });
});
