import Peer, { type DataConnection } from 'peerjs';

// Mesh networking: PeerJS's free public cloud broker is used ONLY to exchange
// the one-time WebRTC handshake info (SDP/ICE). Once connections open, all
// chat data flows directly device-to-device (peer-to-peer) - no server involved.
//
// Topology: the room creator's Peer ID *is* the room code (namespaced). Every
// other device connects to that ID to join. Whoever is host keeps the roster
// and broadcasts it on change; new members use the roster to open direct
// connections to every other member, forming a full mesh - so after the
// initial join, no message ever passes through the host or the broker again.

const APP_NS = 'wifichat-v1-';

function normalizeCode(code: string): string {
  return APP_NS + code.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function uuid(): string {
  return crypto.randomUUID();
}

export interface RosterMember {
  id: string;
  name: string;
}

// Files travel as a stream of chunks rather than one message: a multi-GB
// ArrayBuffer can't even be allocated, and PeerJS would otherwise queue the
// whole thing in memory. The receiver collects chunks as Blob parts, which the
// browser is free to page out to disk.
export const FILE_CHUNK_BYTES = 64 * 1024;
// Pause sending while this much is queued on a channel, so a big file never
// sits in memory waiting for the network.
const MAX_QUEUED_BYTES = 4 * 1024 * 1024;

export interface IncomingAttachment {
  name: string;
  mime: string;
  size: number;
  blob: Blob;
}

export interface IncomingChat {
  from: string;
  fromName: string;
  scope: 'global' | 'direct';
  to?: string;
  text: string;
  ts: number;
  msgId: string;
  attachment?: IncomingAttachment;
}

export interface FileMeta {
  name: string;
  mime: string;
  size: number;
}

export interface TransferProgress {
  msgId: string;
  direction: 'in' | 'out';
  threadId: string;
  peerName: string;
  name: string;
  done: number;
  total: number;
}

type ChatHeader = { scope: 'global' | 'direct'; from: string; fromName: string; to?: string; text: string; ts: number; msgId: string };

interface IncomingFile {
  header: ChatHeader;
  meta: FileMeta;
  parts: Blob[];
  pending: ArrayBuffer[];
  pendingBytes: number;
  received: number;
}

type WireMessage =
  | { type: 'hello'; name: string }
  | { type: 'roster'; members: RosterMember[] }
  | ({ type: 'chat' } & ChatHeader)
  | ({ type: 'file-start'; file: FileMeta } & ChatHeader)
  | { type: 'file-chunk'; msgId: string; data: ArrayBuffer }
  | { type: 'file-end'; msgId: string }
  | { type: 'file-abort'; msgId: string };

export interface MeshCallbacks {
  onRoster: (members: RosterMember[]) => void;
  onMessage: (msg: IncomingChat) => void;
  onStatus: (peerId: string, status: 'online' | 'offline' | 'disconnected') => void;
  onError: (err: Error & { type?: string }) => void;
  onTransfer: (progress: TransferProgress | { msgId: string; finished: true }) => void;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class Mesh {
  readonly deviceId: string;
  private name: string;
  private cb: MeshCallbacks;

  private peer: Peer | null = null;
  myId: string | null = null;
  isHost = false;
  roomCode: string | null = null;
  private conns = new Map<string, DataConnection>();
  private roster = new Map<string, { name: string }>();
  // In-flight incoming files, keyed by sender then msgId.
  private incoming = new Map<string, Map<string, IncomingFile>>();

  constructor(deviceId: string, name: string, callbacks: MeshCallbacks) {
    this.deviceId = deviceId;
    this.name = name;
    this.cb = callbacks;
  }

  private emitRoster() {
    const members = [...this.roster.entries()].map(([id, v]) => ({ id, name: v.name }));
    this.cb.onRoster(members);
  }

  private broadcastRoster() {
    if (!this.isHost) return;
    const members = [...this.roster.entries()].map(([id, v]) => ({ id, name: v.name }));
    const msg: WireMessage = { type: 'roster', members };
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send(msg);
    }
  }

  private setupConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      const hello: WireMessage = { type: 'hello', name: this.name };
      conn.send(hello);
      this.cb.onStatus(conn.peer, 'online');
    });

    conn.on('data', (data) => this.handleData(conn, data as WireMessage));

    conn.on('close', () => {
      // Anything half-received from this peer can never complete.
      for (const msgId of this.incoming.get(conn.peer)?.keys() ?? []) this.cb.onTransfer({ msgId, finished: true });
      this.incoming.delete(conn.peer);
      this.conns.delete(conn.peer);
      this.roster.delete(conn.peer);
      this.cb.onStatus(conn.peer, 'offline');
      this.emitRoster();
      if (this.isHost) this.broadcastRoster();
    });

    conn.on('error', (err) => this.cb.onError(err));
  }

  private handleData(conn: DataConnection, data: WireMessage) {
    const id = conn.peer;
    switch (data.type) {
      case 'hello': {
        this.roster.set(id, { name: data.name });
        this.emitRoster();
        if (this.isHost) this.broadcastRoster();
        break;
      }
      case 'roster': {
        for (const m of data.members) {
          if (m.id === this.myId) continue;
          this.roster.set(m.id, { name: m.name });
          if (!this.conns.has(m.id)) this.connectTo(m.id);
        }
        this.emitRoster();
        break;
      }
      case 'chat': {
        const { type: _type, ...header } = data;
        this.cb.onMessage(header);
        break;
      }
      case 'file-start': {
        const { type: _type, file, ...header } = data;
        let perPeer = this.incoming.get(id);
        if (!perPeer) this.incoming.set(id, (perPeer = new Map()));
        perPeer.set(header.msgId, { header, meta: file, parts: [], pending: [], pendingBytes: 0, received: 0 });
        this.reportIncoming(header, file, 0);
        break;
      }
      case 'file-chunk': {
        const f = this.incoming.get(id)?.get(data.msgId);
        if (!f) break;
        f.pending.push(data.data);
        f.pendingBytes += data.data.byteLength;
        f.received += data.data.byteLength;
        // Fold chunks into a Blob every few MB so we hold few parts and little
        // raw ArrayBuffer memory at once.
        if (f.pendingBytes >= MAX_QUEUED_BYTES) this.flushPending(f);
        // Throttle progress to roughly once per 1% to keep React renders sane.
        const step = Math.max(FILE_CHUNK_BYTES, Math.floor(f.meta.size / 100));
        if (f.received % step < data.data.byteLength) this.reportIncoming(f.header, f.meta, f.received);
        break;
      }
      case 'file-end': {
        const perPeer = this.incoming.get(id);
        const f = perPeer?.get(data.msgId);
        if (!f) break;
        perPeer!.delete(data.msgId);
        this.flushPending(f);
        const blob = new Blob(f.parts, { type: f.meta.mime });
        this.cb.onTransfer({ msgId: data.msgId, finished: true });
        this.cb.onMessage({ ...f.header, attachment: { ...f.meta, size: blob.size, blob } });
        break;
      }
      case 'file-abort': {
        if (this.incoming.get(id)?.delete(data.msgId)) this.cb.onTransfer({ msgId: data.msgId, finished: true });
        break;
      }
    }
  }

  private flushPending(f: IncomingFile) {
    if (!f.pending.length) return;
    f.parts.push(new Blob(f.pending));
    f.pending = [];
    f.pendingBytes = 0;
  }

  private reportIncoming(header: ChatHeader, meta: FileMeta, done: number) {
    this.cb.onTransfer({
      msgId: header.msgId,
      direction: 'in',
      threadId: header.scope === 'global' ? 'global' : header.from,
      peerName: header.fromName,
      name: meta.name,
      done,
      total: meta.size,
    });
  }

  private connectTo(id: string) {
    if (!this.peer || id === this.myId || this.conns.has(id)) return;
    const conn = this.peer.connect(id, { reliable: true });
    this.setupConnection(conn);
  }

  private createPeer(id: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(id, { debug: 1 });
      peer.on('open', () => resolve(peer));
      peer.on('error', (err) => {
        this.cb.onError(err);
        reject(err);
      });
      peer.on('connection', (conn) => this.setupConnection(conn));
      peer.on('disconnected', () => this.cb.onStatus('__self__', 'disconnected'));
    });
  }

  async createRoom(code: string): Promise<string> {
    this.roomCode = code;
    this.isHost = true;
    this.myId = normalizeCode(code);
    this.peer = await this.createPeer(this.myId);
    this.roster.set(this.myId, { name: this.name });
    this.emitRoster();
    return this.myId;
  }

  async joinRoom(code: string): Promise<string> {
    this.roomCode = code;
    this.isHost = false;
    this.myId = this.deviceId;
    this.peer = await this.createPeer(this.myId);
    this.roster.set(this.myId, { name: this.name });

    const hostId = normalizeCode(code);
    await new Promise<void>((resolve, reject) => {
      const conn = this.peer!.connect(hostId, { reliable: true });
      let settled = false;
      // Register setupConnection's 'open' listener and this resolve listener
      // in the SAME tick, before the connection actually opens. If
      // setupConnection were instead called from inside an 'open' callback,
      // its own 'open' listener would be added after the event already
      // fired and would never run - leaving the connection unregistered.
      this.setupConnection(conn);
      conn.on('open', () => {
        settled = true;
        resolve();
      });
      conn.on('error', (err) => {
        if (!settled) reject(err);
      });
      setTimeout(() => {
        if (!settled) reject(new Error('Timed out reaching that room code. Check the code and try again.'));
      }, 12000);
    });
    return this.myId;
  }

  private header(scope: 'global' | 'direct', text: string, to?: string): ChatHeader {
    return { scope, from: this.myId!, fromName: this.name, to, text, ts: Date.now(), msgId: uuid() };
  }

  private targets(header: ChatHeader): DataConnection[] {
    if (header.scope === 'direct') {
      const conn = this.conns.get(header.to!);
      return conn && conn.open ? [conn] : [];
    }
    return [...this.conns.values()].filter((c) => c.open);
  }

  sendGlobal(text: string): IncomingChat {
    const header = this.header('global', text);
    for (const conn of this.targets(header)) conn.send({ type: 'chat', ...header } satisfies WireMessage);
    return header;
  }

  sendDirect(toId: string, text: string): IncomingChat {
    const header = this.header('direct', text, toId);
    for (const conn of this.targets(header)) conn.send({ type: 'chat', ...header } satisfies WireMessage);
    return header;
  }

  // Starts streaming a file to the thread's recipients. Returns the chat
  // header immediately (so the sender can store and show the message) plus a
  // promise that settles once every chunk has been handed to the network.
  sendFile(threadId: string, text: string, file: Blob, meta: FileMeta): { header: IncomingChat; done: Promise<void> } {
    const header = threadId === 'global' ? this.header('global', text) : this.header('direct', text, threadId);
    const done = this.streamFile(header, file, meta, threadId);
    return { header, done };
  }

  private async streamFile(header: ChatHeader, file: Blob, meta: FileMeta, threadId: string) {
    let conns = this.targets(header);
    const peerName = header.scope === 'direct' ? (this.roster.get(header.to!)?.name ?? '') : 'everyone';
    const report = (done: number) =>
      this.cb.onTransfer({ msgId: header.msgId, direction: 'out', threadId, peerName, name: meta.name, done, total: meta.size });

    for (const conn of conns) conn.send({ type: 'file-start', file: meta, ...header } satisfies WireMessage);
    report(0);
    try {
      let lastReport = 0;
      for (let offset = 0; offset < meta.size && conns.length; offset += FILE_CHUNK_BYTES) {
        const data = await file.slice(offset, offset + FILE_CHUNK_BYTES).arrayBuffer();
        // Wait for the slowest recipient to drain; drop any that disconnect.
        for (;;) {
          conns = conns.filter((c) => c.open);
          if (!conns.some((c) => ((c as DataConnection & { bufferSize?: number }).bufferSize ?? 0) > 0 || c.dataChannel.bufferedAmount > MAX_QUEUED_BYTES)) break;
          await sleep(15);
        }
        for (const conn of conns) conn.send({ type: 'file-chunk', msgId: header.msgId, data } satisfies WireMessage);
        const sent = offset + data.byteLength;
        if (sent - lastReport >= meta.size / 100 || sent === meta.size) {
          lastReport = sent;
          report(sent);
        }
      }
      for (const conn of conns) if (conn.open) conn.send({ type: 'file-end', msgId: header.msgId } satisfies WireMessage);
    } catch (e) {
      for (const conn of conns) if (conn.open) conn.send({ type: 'file-abort', msgId: header.msgId } satisfies WireMessage);
      throw e;
    } finally {
      this.cb.onTransfer({ msgId: header.msgId, finished: true });
    }
  }

  isPeerOnline(id: string): boolean {
    const conn = this.conns.get(id);
    return !!(conn && conn.open);
  }

  leave() {
    for (const conn of this.conns.values()) {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    this.roster.clear();
    this.incoming.clear();
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        /* ignore */
      }
    }
    this.peer = null;
    this.myId = null;
    this.isHost = false;
  }
}
