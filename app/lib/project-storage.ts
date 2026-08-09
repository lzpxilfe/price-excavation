const DATABASE_NAME = "price-excavation-local";
const STORE_NAME = "projects";
const ACTIVE_PROJECT_KEY = "active-project";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadActiveProject<T>(): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;

  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(ACTIVE_PROJECT_KEY);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function saveActiveProject<T>(project: T): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(project, ACTIVE_PROJECT_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearActiveProject(): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(ACTIVE_PROJECT_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}
