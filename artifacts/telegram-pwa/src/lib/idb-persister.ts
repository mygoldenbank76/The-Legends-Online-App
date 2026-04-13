/**
 * IndexedDB persister for @tanstack/react-query-persist-client.
 *
 * Stores the entire React Query cache on disk (IndexedDB).
 * On next app open, data is restored instantly before any network request,
 * giving the same "instant open" experience as Telegram / WhatsApp.
 *
 * Capacity: IndexedDB can hold hundreds of MB — no practical limit for message metadata.
 * Actual media blobs are handled separately by the Service Worker cache.
 */

import type { Persister, PersistedClient } from '@tanstack/react-query-persist-client';

const DB_NAME    = 'legends-query-v1';
const DB_VERSION = 1;
const STORE      = 'cache';
const KEY        = 'client';

// Singleton DB connection
let _db: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function getDB(): Promise<IDBDatabase> {
  if (!_db) _db = openDB();
  return _db;
}

function idbGet(db: IDBDatabase): Promise<PersistedClient | undefined> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result as PersistedClient | undefined);
    req.onerror   = () => reject(req.error);
  });
}

function idbSet(db: IDBDatabase, value: PersistedClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value, KEY);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function idbDel(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(KEY);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Create an IndexedDB-backed persister.
 * @param maxAge  How long cached data is considered valid (default: 7 days).
 */
export function createIDBPersister(maxAge = 1000 * 60 * 60 * 24 * 7): Persister {
  return {
    async persistClient(client: PersistedClient) {
      try {
        const db = await getDB();
        await idbSet(db, client);
      } catch {
        // IDB unavailable (private mode, storage full) — silently skip
      }
    },

    async restoreClient() {
      try {
        const db     = await getDB();
        const client = await idbGet(db);
        if (!client) return undefined;
        // Invalidate if older than maxAge
        if (Date.now() - client.timestamp > maxAge) {
          await idbDel(db);
          return undefined;
        }
        return client;
      } catch {
        return undefined;
      }
    },

    async removeClient() {
      try {
        const db = await getDB();
        await idbDel(db);
      } catch {}
    },
  };
}
