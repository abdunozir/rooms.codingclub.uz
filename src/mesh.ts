import Peer, { type DataConnection } from 'peerjs';
import { openFileChannel, progressMeter, receiveFilesOn, sendFileOver, type FileMeta } from './fileChannel.ts';

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

export interface TransferProgress {
  msgId: string;
  direction: 'in' | 'out';
  threadId: string;
  peerName: string;
  name: string;
  done: number;
  total: number;
  // Smoothed transfer speed in bytes/second.
  rate: number;
}

export type { FileMeta };

type ChatHeader = { scope: 'global' | 'direct'; from: string; fromName: string; to?: string; text: string; ts: number; msgId: string };

type WireMessage =
  | { type: 'hello'; name: string }
  | { type: 'roster'; members: RosterMember[] }
  | ({ type: 'chat' } & ChatHeader);

export interface MeshCallbacks {
  onRoster: (members: RosterMember[]) => void;
  onMessage: (msg: IncomingChat) => void;
  onStatus: (peerId: string, status: 'online' | 'offline' | 'disconnected') => void;
  onError: (err: Error & { type?: string }) => void;
  onTransfer: (progress: TransferProgress | { msgId: string; finished: true }) => void;
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
  // Per-peer raw channel for file bytes (see fileChannel.ts), plus a hook
  // that abandons that peer's half-received files when it disconnects.
  // Keyed by connection, not peer id: if two connections to one peer ever
  // coexist, each keeps its own channel on its own RTCPeerConnection.
  private fileChannels = new Map<DataConnection, { channel: RTCDataChannel; pc: RTCPeerConnection; abandon: () => void }>();

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
      this.setupFileChannel(conn);
      const hello: WireMessage = { type: 'hello', name: this.name };
      conn.send(hello);
      this.cb.onStatus(conn.peer, 'online');
    });

    conn.on('data', (data) => this.handleData(conn, data as WireMessage));

    conn.on('close', () => {
      this.closeFileChannel(conn);
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
    }
  }

  private setupFileChannel(conn: DataConnection) {
    if (this.fileChannels.has(conn)) return;
    const pc = conn.peerConnection;
    const channel = openFileChannel(pc);
    const abandon = receiveFilesOn<ChatHeader>(channel, {
      onStart: (header, meta) => {
        const threadId = header.scope === 'global' ? 'global' : header.from;
        return progressMeter(meta.size, (done, rate) =>
          this.cb.onTransfer({ msgId: header.msgId, direction: 'in', threadId, peerName: header.fromName, name: meta.name, done, total: meta.size, rate }),
        );
      },
      onComplete: (header, meta, blob) => {
        this.cb.onTransfer({ msgId: header.msgId, finished: true });
        this.cb.onMessage({ ...header, attachment: { ...meta, size: blob.size, blob } });
      },
      onAbort: (header) => this.cb.onTransfer({ msgId: header.msgId, finished: true }),
    });
    this.fileChannels.set(conn, { channel, pc, abandon });
  }

  private closeFileChannel(conn: DataConnection) {
    const fc = this.fileChannels.get(conn);
    if (!fc) return;
    this.fileChannels.delete(conn);
    fc.abandon();
    try {
      fc.channel.close();
    } catch {
      /* ignore */
    }
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
    const recipients = this.targets(header).flatMap((c) => {
      const fc = this.fileChannels.get(c);
      return fc ? [fc] : [];
    });
    const peerName = header.scope === 'direct' ? (this.roster.get(header.to!)?.name ?? '') : 'everyone';
    const progress = progressMeter(meta.size, (done, rate) =>
      this.cb.onTransfer({ msgId: header.msgId, direction: 'out', threadId, peerName, name: meta.name, done, total: meta.size, rate }),
    );
    try {
      await sendFileOver(recipients, header, file, meta, progress);
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
    for (const conn of [...this.fileChannels.keys()]) this.closeFileChannel(conn);
    this.conns.clear();
    this.roster.clear();
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
