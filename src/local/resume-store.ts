import type { LocalResumeMetadata } from "../types";

const DATABASE_NAME = "jobflow-local-v2";
const STORE_NAME = "resume_sources";
const DATABASE_VERSION = 1;

interface StoredResume {
  key: string;
  metadata: LocalResumeMetadata;
  contentType: "binary" | "text";
  content: ArrayBuffer | string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地简历存储"));
  });
}

function resumeKey(userId: string, sourceHash: string): string {
  return userId + ":" + sourceHash;
}

async function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地简历存储操作失败"));
  });
}

export async function storeResumeFile(
  metadata: LocalResumeMetadata,
  file: File
): Promise<void> {
  const content = await file.arrayBuffer();
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const record: StoredResume = {
      key: resumeKey(metadata.userId, metadata.sourceHash),
      metadata,
      contentType: "binary",
      content
    };
    await requestResult(transaction.objectStore(STORE_NAME).put(record));
  } finally {
    database.close();
  }
}

export async function storeResumeText(
  metadata: LocalResumeMetadata,
  text: string
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const record: StoredResume = {
      key: resumeKey(metadata.userId, metadata.sourceHash),
      metadata,
      contentType: "text",
      content: text
    };
    await requestResult(transaction.objectStore(STORE_NAME).put(record));
  } finally {
    database.close();
  }
}

export async function getResumeMetadata(
  userId: string,
  sourceHash: string
): Promise<LocalResumeMetadata | null> {
  const database = await openDatabase();
  try {
    const record = await requestResult(
      database.transaction(STORE_NAME).objectStore(STORE_NAME).get(resumeKey(userId, sourceHash))
    ) as StoredResume | undefined;
    return record?.metadata ?? null;
  } finally {
    database.close();
  }
}

export async function deleteResume(
  userId: string,
  sourceHash: string
): Promise<void> {
  const database = await openDatabase();
  try {
    await requestResult(
      database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(resumeKey(userId, sourceHash))
    );
  } finally {
    database.close();
  }
}

export async function deleteUserResumes(userId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const records = await requestResult(
      database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll()
    ) as StoredResume[];
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await Promise.all(
      records
        .filter((record) => record.metadata.userId === userId)
        .map((record) => requestResult(store.delete(record.key)))
    );
  } finally {
    database.close();
  }
}
