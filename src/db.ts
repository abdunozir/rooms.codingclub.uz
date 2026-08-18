// IndexedDB is this app's entire database - all identity, room, and message
// data lives only on the local device, nothing is ever sent to a server.

const DB_NAME = 'wifichat-db';
const DB_VERSION = 1;

export interface Identity {
  deviceId: string;
  name: string;
}

export interface StoredMessage {
  id?: number;
  roomCode: string;
  threadId: string; // 'global' or the peer's id
  senderId: string;
  senderName: string;
  text: string;
  ts: number;
  self: boolean;
}

export interface RecentRoom {
  roomCode: string;
  lastJoined: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('identity')) {
        db.createObjectStore('identity', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        store.createIndex('byThread', ['roomCode', 'threadId']);
      }
      if (!db.objectStoreNames.contains('rooms')) {
        db.createObjectStore('rooms', { keyPath: 'roomCode' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(storeName, mode).objectStore(storeName);
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  async getIdentity(): Promise<Identity | null> {
    const store = await tx('identity', 'readonly');
    const result = await wrap(store.get('me'));
    return (result as (Identity & { key: string }) | undefined) ?? null;
  },

  async saveIdentity(identity: Identity): Promise<void> {
    const store = await tx('identity', 'readwrite');
    await wrap(store.put({ key: 'me', ...identity }));
  },

  async addMessage(msg: StoredMessage): Promise<number> {
    const store = await tx('messages', 'readwrite');
    return wrap(store.add(msg) as IDBRequest<number>);
  },

  async getThreadMessages(roomCode: string, threadId: string): Promise<StoredMessage[]> {
    const store = await tx('messages', 'readonly');
    const index = store.index('byThread');
    const range = IDBKeyRange.only([roomCode, threadId]);
    return wrap(index.getAll(range) as IDBRequest<StoredMessage[]>);
  },

  async touchRoom(roomCode: string): Promise<void> {
    const store = await tx('rooms', 'readwrite');
    await wrap(store.put({ roomCode, lastJoined: Date.now() }));
  },

  async getRecentRooms(): Promise<RecentRoom[]> {
    const store = await tx('rooms', 'readonly');
    const all = await wrap(store.getAll() as IDBRequest<RecentRoom[]>);
    return all.sort((a, b) => b.lastJoined - a.lastJoined);
  },
};
