const DATABASE = "drivemd";
const STORE = "drafts";

/**
 * A note's unsaved text, kept on the device as the user types, so that it
 * survives a reload, a crash or iOS closing the app: with the revision it
 * was edited from, which tells whether Drive changed the note since.
 */
export interface Draft {
  fileId: string;
  /** The note's name when the text was kept, so that Home lists it at once. */
  name: string;
  /** The note's resource key, if it has one: Home opens it with it. */
  resourceKey: string | undefined;
  headRevisionId: string | undefined;
  md5Checksum: string | undefined;
  text: string;
  /** When the text was kept last, in ISO 8601. */
  keptAt: string;
}

/** A draft as stored: each account's apart, keyed by account and file. */
interface Stored extends Draft {
  account: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, {
        keyPath: ["account", "fileId"],
      });
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB did not open"));
    };
  });
}

/** Runs one request in a transaction of its own, once that has finished. */
async function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = act(transaction.objectStore(STORE));
      transaction.oncomplete = () => {
        resolve(request.result);
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("IndexedDB gave up"));
      };
    });
  } finally {
    database.close();
  }
}

/** Every key of an account's drafts: arrays sort after strings. */
function ofAccount(account: string): IDBKeyRange {
  return IDBKeyRange.bound([account], [account, []]);
}

export async function writeDraft(account: string, draft: Draft): Promise<void> {
  const stored: Stored = { ...draft, account };
  await run("readwrite", (store) => store.put(stored));
}

export async function readDraft(
  account: string,
  fileId: string,
): Promise<Draft | undefined> {
  const stored = (await run("readonly", (store) =>
    store.get([account, fileId]),
  )) as Stored | undefined;
  if (!stored) return undefined;
  const { fileId: id, name, resourceKey } = stored;
  const { headRevisionId, md5Checksum, text, keptAt } = stored;
  return {
    fileId: id,
    name,
    resourceKey,
    headRevisionId,
    md5Checksum,
    text,
    keptAt,
  };
}

/** A note with unsaved text on the device, as Home lists it: without the text. */
export type DraftEntry = Pick<
  Draft,
  "fileId" | "name" | "resourceKey" | "keptAt"
>;

/** The account's notes with unsaved text on the device, the latest first. */
export async function listDrafts(account: string): Promise<DraftEntry[]> {
  const stored = (await run("readonly", (store) =>
    store.getAll(ofAccount(account)),
  )) as Stored[];
  return stored
    .map(({ fileId, name, resourceKey, keptAt }) => ({
      fileId,
      name,
      resourceKey,
      keptAt,
    }))
    .toSorted((a, b) => Date.parse(b.keptAt) - Date.parse(a.keptAt));
}

export async function deleteDraft(
  account: string,
  fileId: string,
): Promise<void> {
  await run("readwrite", (store) => store.delete([account, fileId]));
}

/**
 * Forgets a note's text, unless the device holds other text for it by now,
 * as another tab may have kept since it was read.
 */
export async function deleteDraftHolding(
  account: string,
  fileId: string,
  text: string,
): Promise<void> {
  await run("readwrite", (store) => {
    const request = store.openCursor([account, fileId]);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && (cursor.value as Stored).text === text) cursor.delete();
    };
    return request;
  });
}

/** How many notes of the account have unsaved text on the device. */
export function countDrafts(account: string): Promise<number> {
  return run("readonly", (store) => store.count(ofAccount(account)));
}

/** Forgets every unsaved text of the account on the device. */
export async function deleteDrafts(account: string): Promise<void> {
  await run("readwrite", (store) => store.delete(ofAccount(account)));
}
