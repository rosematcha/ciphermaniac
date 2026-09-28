/**
 * Linking the .tdf TOM saves to, so the site follows the event without anyone
 * re-uploading it.
 *
 * Chromium browsers (Chrome, Edge: what a TOM laptop runs) can hold a handle
 * to a file on disk through the File System Access API. The organizer picks
 * the file once; the page then checks its modified time every couple of
 * seconds and, when TOM has saved, reads and parses it locally and sends the
 * parsed event up. The handle is kept in IndexedDB so a reload only has to ask
 * the browser for permission again, not for the file.
 *
 * The same handle can be written: results entered on the site go into the
 * file for TOM to open. TOM keeps its own copy in memory and saves over the
 * file, so the organizer has to reopen the event in TOM after a write.
 *
 * Other browsers fall back to picking the file each time.
 */

interface PermissionDescriptor {
  mode: 'read' | 'readwrite';
}

/** The parts of FileSystemFileHandle this uses; TypeScript's DOM types lack the permission calls. */
export interface TdfHandle {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  queryPermission?: (descriptor: PermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor: PermissionDescriptor) => Promise<PermissionState>;
}

type FilePicker = (options: {
  types: { description: string; accept: Record<string, string[]> }[];
  excludeAcceptedTypesOption?: boolean;
}) => Promise<TdfHandle[]>;

function picker(): FilePicker | null {
  const candidate = (window as unknown as { showOpenFilePicker?: FilePicker }).showOpenFilePicker;
  return typeof candidate === 'function' ? candidate.bind(window) : null;
}

export function canLinkFiles(): boolean {
  return typeof window !== 'undefined' && picker() !== null;
}

/** Asks the organizer for the .tdf. Throws AbortError when they cancel. */
export async function pickTdf(): Promise<TdfHandle> {
  const open = picker();
  if (!open) {
    throw new Error('This browser cannot link files');
  }
  const [handle] = await open({
    types: [{ description: 'TOM tournament', accept: { 'application/xml': ['.tdf'] } }],
    excludeAcceptedTypesOption: true
  });
  if (!handle) {
    throw new Error('No file picked');
  }
  return handle;
}

/**
 * Whether the page may use the handle for `mode`, asking if it must. Asking
 * needs a click in progress, so call this from one.
 */
export async function ensurePermission(handle: TdfHandle, mode: 'read' | 'readwrite', ask: boolean): Promise<boolean> {
  const state = (await handle.queryPermission?.({ mode })) ?? 'granted';
  if (state === 'granted' || !ask) {
    return state === 'granted';
  }
  return (await handle.requestPermission?.({ mode })) === 'granted';
}

export interface FileRead {
  text: string;
  lastModified: number;
}

/** The file's text, or null when it has not changed since `lastModified`. */
export async function readIfChanged(handle: TdfHandle, lastModified: number): Promise<FileRead | null> {
  const file = await handle.getFile();
  if (file.lastModified === lastModified) {
    return null;
  }
  return { text: await file.text(), lastModified: file.lastModified };
}

export async function writeFile(handle: TdfHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

// ---------- remembering the handle ----------

const DB_NAME = 'ciphermaniac-tournaments';
const STORE = 'tdf-handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function rememberHandle(code: string, handle: TdfHandle): Promise<void> {
  await withStore('readwrite', store => store.put(handle, code));
}

export async function recallHandle(code: string): Promise<TdfHandle | null> {
  try {
    return ((await withStore('readonly', store => store.get(code))) as TdfHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function forgetHandle(code: string): Promise<void> {
  await withStore('readwrite', store => store.delete(code));
}
