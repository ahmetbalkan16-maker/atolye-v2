/**
 * Minimal, faithful fake of the browser IndexedDB API — covers exactly the
 * operations `phoneLlmIdbStorage.ts` uses (open + `onupgradeneeded`,
 * `createObjectStore(name, {keyPath})`, one transaction spanning a single
 * store, `get`/`put`/`delete` by exact key). Deliberately does NOT
 * implement cursors, indexes, or key ranges — `phoneLlmIdbStorage.ts`
 * doesn't use them (see that file's header for why), so neither does this.
 *
 * Event timing matches the real API closely enough to matter: `open()`,
 * `get()`, `put()`, and `delete()` all return a request object synchronously
 * and fire `onsuccess`/`onerror` on a LATER microtask — callers that attach
 * handlers immediately after the synchronous call (the only pattern
 * `phoneLlmIdbStorage.ts` uses) behave identically to the real API.
 *
 * Install with `installFakeIndexedDb()` before importing/using any module
 * that touches `indexedDB`; `resetFakeIndexedDb()` clears all stored data
 * between test scenarios without needing a fresh module import.
 */

interface StoreRecord {
  [key: string]: unknown;
}

class FakeIDBRequest<T = unknown> {
  result: T | undefined;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  _succeed(result: T): void {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.());
  }

  _fail(error: Error): void {
    this.error = error;
    queueMicrotask(() => this.onerror?.());
  }
}

class FakeObjectStore {
  constructor(private readonly data: Map<string, StoreRecord>) {}

  get(key: string): FakeIDBRequest<StoreRecord | undefined> {
    const request = new FakeIDBRequest<StoreRecord | undefined>();
    request._succeed(this.data.get(key));
    return request;
  }

  put(value: StoreRecord): FakeIDBRequest<string> {
    const request = new FakeIDBRequest<string>();
    const key = value.key as string;
    this.data.set(key, value);
    request._succeed(key);
    return request;
  }

  delete(key: string): FakeIDBRequest<undefined> {
    const request = new FakeIDBRequest<undefined>();
    this.data.delete(key);
    request._succeed(undefined);
    return request;
  }
}

class FakeTransaction {
  onerror: (() => void) | null = null;
  constructor(private readonly stores: Map<string, Map<string, StoreRecord>>) {}
  objectStore(name: string): FakeObjectStore {
    const store = this.stores.get(name);
    if (!store) throw new Error(`FakeIndexedDb: no such object store "${name}"`);
    return new FakeObjectStore(store);
  }
}

class FakeIDBDatabase {
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  constructor(private readonly stores: Map<string, Map<string, StoreRecord>>) {}
  /** No-op — this fake has no real connection/handle to release; exists only so code that calls `db.close()` (e.g. `reopenPhoneLlmDbForDiagnostics`) works unchanged against the fake. */
  close(): void {}
  /** `options` (e.g. `{ keyPath: "key" }`) is accepted for call-site compatibility but unused — every record this fake stores already carries its own `key` property, which is all `get`/`put`/`delete` need. */
  createObjectStore(name: string): void {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
  }
  /** `mode` ("readonly"/"readwrite") is accepted for call-site compatibility but unused — this fake has no concurrency to guard against. */
  transaction(storeNames: string | string[]): FakeTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const name of names) {
      if (!this.stores.has(name)) throw new Error(`FakeIndexedDb: no such object store "${name}"`);
    }
    return new FakeTransaction(this.stores);
  }
}

class FakeIndexedDbFactory {
  private stores = new Map<string, Map<string, StoreRecord>>();

  /** `name`/`version` accepted for call-site compatibility but unused — this fake only ever backs one implicit database. */
  open(): FakeIDBRequest<FakeIDBDatabase> & { onupgradeneeded: (() => void) | null } {
    const request = new FakeIDBRequest<FakeIDBDatabase>() as FakeIDBRequest<FakeIDBDatabase> & { onupgradeneeded: (() => void) | null };
    request.onupgradeneeded = null;
    const db = new FakeIDBDatabase(this.stores);
    queueMicrotask(() => {
      // Real IndexedDB: `request.result` is already the (upgraded)
      // database by the time `onupgradeneeded` fires — set it directly
      // rather than going through `_succeed` (which would also schedule
      // `onsuccess` on yet another microtask; upgradeneeded then success
      // both fire from this same callback, upgradeneeded first).
      request.result = db;
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }

  /**
   * Test-only: wipes all stored DATA while preserving the already-created
   * object stores in place. Must clear each inner Map's CONTENTS rather
   * than replace `this.stores` with a new Map — `phoneLlmIdbStorage.ts`
   * memoizes its `FakeIDBDatabase` connection at module scope across the
   * whole test run, and that instance holds a direct reference to these
   * SAME inner Maps (not a copy); replacing the outer Map would silently
   * stop affecting an already-opened connection.
   */
  reset(): void {
    for (const store of this.stores.values()) store.clear();
  }
}

let installed: FakeIndexedDbFactory | null = null;

/** Installs the fake `indexedDB` global. Call once before any code under test touches `indexedDB`. */
export function installFakeIndexedDb(): void {
  installed = new FakeIndexedDbFactory();
  (globalThis as { indexedDB?: unknown }).indexedDB = installed;
}

/** Clears all stored data — use between scenarios instead of reinstalling, since `phoneLlmIdbStorage.ts` memoizes its DB connection promise at module scope. */
export function resetFakeIndexedDb(): void {
  if (!installed) throw new Error("installFakeIndexedDb() must be called first");
  installed.reset();
}

/** Removes the fake `indexedDB` global entirely — for the "not available" scenario. */
export function uninstallFakeIndexedDb(): void {
  installed = null;
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
}
