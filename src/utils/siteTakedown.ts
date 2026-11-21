export const KNOWN_INDEXED_DB_NAMES = [
  'path_to_cgl_idb_v1',
  'firebaseLocalStorageDb',
  'firebase-heartbeat-database',
  'firebase-installations-database',
];

export interface StorageClearable {
  clear(): void;
}

export interface ServiceWorkerRegistrationLike {
  unregister(): Promise<boolean>;
}

export interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(cacheName: string): Promise<boolean>;
}

export interface IndexedDbFactoryLike {
  databases?: () => Promise<Array<{ name?: string }>>;
  deleteDatabase(name: string): unknown;
}

export interface WipeClientDeps {
  localStorage?: StorageClearable | null;
  sessionStorage?: StorageClearable | null;
  serviceWorker?: {
    getRegistrations(): Promise<readonly ServiceWorkerRegistrationLike[]>;
  } | null;
  caches?: CacheStorageLike | null;
  indexedDB?: IndexedDbFactoryLike | null;
}

export interface WipeClientSummary {
  serviceWorkersUnregistered: number;
  cachesDeleted: number;
  indexedDbsRequested: number;
  localStorageCleared: boolean;
  sessionStorageCleared: boolean;
}

function resolveDefaultDeps(): WipeClientDeps {
  return {
    localStorage: typeof localStorage !== 'undefined' ? localStorage : null,
    sessionStorage: typeof sessionStorage !== 'undefined' ? sessionStorage : null,
    serviceWorker:
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker
        : null,
    caches: typeof caches !== 'undefined' ? caches : null,
    indexedDB: typeof indexedDB !== 'undefined' ? indexedDB : null,
  };
}

export async function wipeClientOfflineState(
  deps: WipeClientDeps = resolveDefaultDeps()
): Promise<WipeClientSummary> {
  let localStorageCleared = false;
  let sessionStorageCleared = false;
  let serviceWorkersUnregistered = 0;
  let cachesDeleted = 0;
  let indexedDbsRequested = 0;

  try {
    if (deps.localStorage) {
      deps.localStorage.clear();
      localStorageCleared = true;
    }
  } catch {
    // Ignore restricted storage errors
  }

  try {
    if (deps.sessionStorage) {
      deps.sessionStorage.clear();
      sessionStorageCleared = true;
    }
  } catch {
    // Ignore restricted storage errors
  }

  try {
    if (deps.serviceWorker) {
      const registrations = await deps.serviceWorker.getRegistrations();
      const results = await Promise.all(
        registrations.map((reg) => reg.unregister().catch(() => false))
      );
      serviceWorkersUnregistered = results.filter(Boolean).length;
    }
  } catch {
    // Ignore SW errors
  }

  try {
    if (deps.caches) {
      const keys = await deps.caches.keys();
      const results = await Promise.all(
        keys.map((key) => deps.caches!.delete(key).catch(() => false))
      );
      cachesDeleted = results.filter(Boolean).length;
    }
  } catch {
    // Ignore Cache Storage errors
  }

  try {
    if (deps.indexedDB) {
      const names = new Set<string>(KNOWN_INDEXED_DB_NAMES);
      if (typeof deps.indexedDB.databases === 'function') {
        try {
          const discovered = await deps.indexedDB.databases();
          for (const db of discovered) {
            if (db && typeof db.name === 'string' && db.name.trim()) {
              names.add(db.name);
            }
          }
        } catch {
          // Fallback to known DB names
        }
      }
      for (const name of names) {
        try {
          deps.indexedDB.deleteDatabase(name);
          indexedDbsRequested += 1;
        } catch {
          // Ignore individual DB deletion failure
        }
      }
    }
  } catch {
    // Ignore IndexedDB errors
  }

  return {
    serviceWorkersUnregistered,
    cachesDeleted,
    indexedDbsRequested,
    localStorageCleared,
    sessionStorageCleared,
  };
}
