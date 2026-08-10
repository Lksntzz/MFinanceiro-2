export type MobileSharedFile = {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  blob: Blob;
};

export type MobileSharedPayload = {
  id: string;
  createdAt: number;
  title: string;
  text: string;
  url: string;
  files: MobileSharedFile[];
};

const DB_NAME = 'mf-mobile-share';
const STORE_NAME = 'shares';
const DB_VERSION = 1;

function openShareDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento de compartilhamentos.'));
  });
}

async function writeMobileSharedPayload(payload: MobileSharedPayload) {
  const db = await openShareDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(payload);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível atualizar o compartilhamento.'));
      transaction.onabort = () => reject(transaction.error || new Error('Não foi possível atualizar o compartilhamento.'));
    });
  } finally {
    db.close();
  }
}

export async function getMobileSharedPayload(id: string) {
  const db = await openShareDb();
  try {
    return await new Promise<MobileSharedPayload | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as MobileSharedPayload | undefined) || null);
      request.onerror = () => reject(request.error || new Error('Não foi possível ler o conteúdo compartilhado.'));
    });
  } finally {
    db.close();
  }
}

export async function keepOnlyUnreviewedSharedFiles(payload: MobileSharedPayload, reviewedIndex: number) {
  const remainingFiles = payload.files.filter((_, index) => index !== reviewedIndex);
  if (!remainingFiles.length) {
    await removeMobileSharedPayload(payload.id);
    return null;
  }

  const nextPayload: MobileSharedPayload = {
    ...payload,
    files: remainingFiles,
  };
  await writeMobileSharedPayload(nextPayload);
  return nextPayload;
}

export async function removeMobileSharedPayload(id: string) {
  const db = await openShareDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível limpar o compartilhamento.'));
      transaction.onabort = () => reject(transaction.error || new Error('Não foi possível limpar o compartilhamento.'));
    });
  } finally {
    db.close();
  }
}

export function sharedFileToFile(file: MobileSharedFile) {
  return new File([file.blob], file.name || 'documento', {
    type: file.type || file.blob.type || 'application/octet-stream',
    lastModified: file.lastModified || Date.now(),
  });
}
