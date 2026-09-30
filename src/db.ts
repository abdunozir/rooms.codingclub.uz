// IndexedDB is this app's entire database - all identity, room, and message
// data lives only on the local device, nothing is ever sent to a server.

const DB_NAME = 'wifichat-db';
const DB_VERSION = 1;

export interface Identity {
  deviceId: string;
  name: string;
}

// Files are kept as Blobs - IndexedDB stores them natively, so a chat full of
// photos doesn't have to be base64-inflated just to persist.
export interface Attachment {
  name: string;
  mime: string;
  size: number;
  blob: Blob;
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
  attachment?: Attachment;
}

export interface RecentRoom {
  roomCode: string;
  lastJoined: number;
}

// Shape of the backup file produced by exportAll() / accepted by importAll().
const EXPORT_VERSION = 1;

// JSON can't hold a Blob, so exported attachments carry their bytes as base64.
// That only scales so far - a backup is one in-memory JSON string - so larger
// files are left out and exported with `omitted: true` and no bytes.
export const MAX_EXPORTED_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface ExportedAttachment {
  name: string;
  mime: string;
  size: number;
  base64?: string;
  omitted?: true;
}

export type ExportedMessage = Omit<StoredMessage, 'id' | 'attachment'> & { attachment?: ExportedAttachment };

export interface ExportBundle {
  app: 'wifichat';
  version: number;
  exportedAt: number;
  identity: Identity | null;
  rooms: RecentRoom[];
  messages: ExportedMessage[];
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function parseExportedAttachment(raw: unknown): Attachment | undefined {
  const a = raw as Partial<ExportedAttachment> | null | undefined;
  if (!a || typeof a.name !== 'string' || typeof a.mime !== 'string' || typeof a.base64 !== 'string') return undefined;
  const blob = base64ToBlob(a.base64, a.mime);
  return { name: a.name, mime: a.mime, size: blob.size, blob };
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

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Identifies a stored message by content, so importing the same backup twice -
// or importing a backup that overlaps chats you already have - doesn't create
// duplicates. There's no stable per-message id shared across devices.
type MessageKey = Pick<StoredMessage, 'roomCode' | 'threadId' | 'senderId' | 'ts' | 'text'> & {
  attachment?: { name: string; size: number };
};

function messageSignature(m: MessageKey): string {
  return [m.roomCode, m.threadId, m.senderId, m.ts, m.text, m.attachment?.name ?? '', m.attachment?.size ?? ''].join('\u0000');
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

  async getAllMessages(): Promise<StoredMessage[]> {
    const store = await tx('messages', 'readonly');
    return wrap(store.getAll() as IDBRequest<StoredMessage[]>);
  },

  // Everything the app knows, as a plain JSON-serializable object: identity,
  // the recent-rooms list, and every message in every thread.
  async exportAll(): Promise<ExportBundle> {
    const [identity, rooms, messages] = await Promise.all([this.getIdentity(), this.getRecentRooms(), this.getAllMessages()]);
    return {
      app: 'wifichat',
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      identity: identity ? { deviceId: identity.deviceId, name: identity.name } : null,
      rooms,
      messages: await Promise.all(
        messages.map(async (m) => {
          const out: ExportedMessage = {
            roomCode: m.roomCode,
            threadId: m.threadId,
            senderId: m.senderId,
            senderName: m.senderName,
            text: m.text,
            ts: m.ts,
            self: m.self,
          };
          if (m.attachment) {
            const { name, mime, size, blob } = m.attachment;
            out.attachment =
              size > MAX_EXPORTED_ATTACHMENT_BYTES ? { name, mime, size, omitted: true } : { name, mime, size, base64: await blobToBase64(blob) };
          }
          return out;
        }),
      ),
    };
  },

  // Merge a bundle from exportAll() into the local database. Non-destructive:
  // existing chats stay, messages already present are skipped (see
  // messageSignature), rooms keep their most recent lastJoined, and identity
  // is only filled in when this device doesn't already have one.
  async importAll(raw: unknown): Promise<{ messages: number; rooms: number; identitySet: boolean }> {
    const bundle = (raw ?? {}) as {
      app?: unknown;
      rooms?: unknown;
      messages?: unknown;
      identity?: { deviceId?: unknown; name?: unknown } | null;
    };
    if (bundle.app !== 'wifichat' || !Array.isArray(bundle.rooms) || !Array.isArray(bundle.messages)) {
      throw new Error('Not a valid WifiChat export file.');
    }
    const rawRooms = bundle.rooms as unknown[];
    const rawMessages = bundle.messages as unknown[];

    const [existingRooms, existingMessages, existingIdentity] = await Promise.all([
      this.getRecentRooms(),
      this.getAllMessages(),
      this.getIdentity(),
    ]);

    const roomLastJoined = new Map(existingRooms.map((r) => [r.roomCode, r.lastJoined]));
    const seen = new Set(existingMessages.map(messageSignature));

    const roomsToPut: RecentRoom[] = [];
    let newRooms = 0;
    for (const entry of rawRooms) {
      const r = entry as { roomCode?: unknown; lastJoined?: unknown };
      if (typeof r.roomCode !== 'string') continue;
      const prev = roomLastJoined.get(r.roomCode);
      if (prev === undefined) newRooms += 1;
      const lastJoined = Math.max(prev ?? 0, typeof r.lastJoined === 'number' ? r.lastJoined : 0);
      roomsToPut.push({ roomCode: r.roomCode, lastJoined });
    }

    const messagesToAdd: Omit<StoredMessage, 'id'>[] = [];
    for (const entry of rawMessages) {
      const m = entry as Record<string, unknown>;
      if (
        typeof m.roomCode !== 'string' ||
        typeof m.threadId !== 'string' ||
        typeof m.senderId !== 'string' ||
        typeof m.senderName !== 'string' ||
        typeof m.text !== 'string' ||
        typeof m.ts !== 'number'
      ) {
        continue;
      }
      const record: Omit<StoredMessage, 'id'> = {
        roomCode: m.roomCode,
        threadId: m.threadId,
        senderId: m.senderId,
        senderName: m.senderName,
        text: m.text,
        ts: m.ts,
        self: m.self === true,
      };
      const attachment = parseExportedAttachment(m.attachment);
      if (attachment) record.attachment = attachment;
      const sig = messageSignature(record);
      if (seen.has(sig)) continue;
      seen.add(sig);
      messagesToAdd.push(record);
    }

    let identityToSet: Identity | null = null;
    const bi = bundle.identity;
    if (!existingIdentity && bi && typeof bi.deviceId === 'string' && typeof bi.name === 'string') {
      identityToSet = { deviceId: bi.deviceId, name: bi.name };
    }

    const database = await openDb();
    const storeNames = identityToSet ? ['messages', 'rooms', 'identity'] : ['messages', 'rooms'];
    const t = database.transaction(storeNames, 'readwrite');
    for (const r of roomsToPut) t.objectStore('rooms').put(r);
    for (const m of messagesToAdd) t.objectStore('messages').add(m);
    if (identityToSet) t.objectStore('identity').put({ key: 'me', ...identityToSet });
    await txDone(t);

    return { messages: messagesToAdd.length, rooms: newRooms, identitySet: identityToSet !== null };
  },
};
