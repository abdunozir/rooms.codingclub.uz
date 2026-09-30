// Bulk file transfer over a dedicated WebRTC data channel.
//
// Chat messages go through PeerJS's DataConnection, which serializes every
// payload with BinaryPack and re-chunks it into ~16 KB pieces - fine for
// text, but for a multi-GB file that means copying every byte several times
// on the main thread. Files instead use a second, raw channel opened on the
// same RTCPeerConnection:
//
//   - `negotiated: true` with a fixed id, so both sides just create it and it
//     opens without any extra signaling round trip.
//   - Binary chunks go out as-is: [uint32 transfer id][bytes]. Control
//     messages (start / end / abort) are JSON strings on the same channel, so
//     they stay ordered relative to the chunks.
//   - Backpressure uses the channel's `bufferedamountlow` event rather than
//     timers, which background tabs throttle to a crawl.

const CHANNEL_ID = 100;
// Keep at most this much queued per channel. Chrome closes a channel whose
// send buffer passes 16 MB, so stay well under that.
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 2 * 1024 * 1024;
// Largest chunk every modern browser accepts in one message. Capped further
// by the connection's negotiated SCTP maxMessageSize.
const MAX_CHUNK = 256 * 1024;
const FALLBACK_CHUNK = 64 * 1024;
const HEADER_BYTES = 4;
// Received chunks are folded into a Blob every this many bytes, so memory
// holds only a few MB of raw buffers and the browser can page the rest to disk.
const FLUSH_BYTES = 8 * 1024 * 1024;

export interface FileMeta {
  name: string;
  mime: string;
  size: number;
}

type Control<H> = { t: 'start'; tid: number; header: H; file: FileMeta } | { t: 'end'; tid: number } | { t: 'abort'; tid: number };

export function openFileChannel(pc: RTCPeerConnection): RTCDataChannel {
  const ch = pc.createDataChannel('files', { negotiated: true, id: CHANNEL_ID, ordered: true });
  ch.binaryType = 'arraybuffer';
  ch.bufferedAmountLowThreshold = LOW_WATER;
  return ch;
}

function whenOpen(ch: RTCDataChannel): Promise<boolean> {
  if (ch.readyState === 'open') return Promise.resolve(true);
  if (ch.readyState !== 'connecting') return Promise.resolve(false);
  return new Promise((resolve) => {
    ch.addEventListener('open', () => resolve(true), { once: true });
    ch.addEventListener('close', () => resolve(false), { once: true });
    ch.addEventListener('error', () => resolve(false), { once: true });
  });
}

async function drain(ch: RTCDataChannel) {
  while (ch.readyState === 'open' && ch.bufferedAmount > HIGH_WATER) {
    await new Promise<void>((resolve) => {
      ch.addEventListener('bufferedamountlow', () => resolve(), { once: true });
      ch.addEventListener('close', () => resolve(), { once: true });
    });
  }
}

function chunkSize(pcs: RTCPeerConnection[]): number {
  let size = MAX_CHUNK;
  for (const pc of pcs) {
    const max = pc.sctp?.maxMessageSize;
    if (max === undefined || max <= 0) size = Math.min(size, FALLBACK_CHUNK);
    else if (Number.isFinite(max)) size = Math.min(size, max);
  }
  return size - HEADER_BYTES;
}

// Throttled progress with a smoothed bytes/second estimate.
export function progressMeter(total: number, emit: (done: number, rate: number) => void) {
  let lastTime = performance.now();
  let lastDone = 0;
  let rate = 0;
  return (done: number, force = false) => {
    const now = performance.now();
    const dt = now - lastTime;
    if (!force && dt < 250) return;
    if (dt > 0) {
      const instant = ((done - lastDone) * 1000) / dt;
      rate = rate ? rate * 0.7 + instant * 0.3 : instant;
    }
    lastTime = now;
    lastDone = done;
    emit(Math.min(done, total), rate);
  };
}

let nextTid = 1;

export interface Recipient {
  channel: RTCDataChannel;
  pc: RTCPeerConnection;
}

// Streams `file` to every recipient in lockstep (the slowest one sets the
// pace). Recipients that disconnect midway are dropped; the rest continue.
export async function sendFileOver<H>(recipients: Recipient[], header: H, file: Blob, meta: FileMeta, onProgress: (done: number, force?: boolean) => void) {
  const opened = await Promise.all(recipients.map((r) => whenOpen(r.channel)));
  let targets = recipients.filter((_, i) => opened[i]);
  const tid = nextTid++;
  const chunk = chunkSize(targets.map((r) => r.pc));

  const send = (data: string | Uint8Array<ArrayBuffer>) => {
    targets = targets.filter((r) => {
      if (r.channel.readyState !== 'open') return false;
      try {
        r.channel.send(data as never);
        return true;
      } catch {
        return false;
      }
    });
  };

  send(JSON.stringify({ t: 'start', tid, header, file: meta } satisfies Control<H>));
  onProgress(0, true);
  try {
    const read = (offset: number) => file.slice(offset, offset + chunk).arrayBuffer();
    // Read ahead: the next slice loads from disk while this one is sending.
    let next: Promise<ArrayBuffer> | null = meta.size > 0 ? read(0) : null;
    let offset = 0;
    while (next && targets.length) {
      const data = await next;
      const after = offset + data.byteLength;
      next = after < meta.size && data.byteLength > 0 ? read(after) : null;

      await Promise.all(targets.map((r) => drain(r.channel)));
      const packet = new Uint8Array(HEADER_BYTES + data.byteLength);
      new DataView(packet.buffer).setUint32(0, tid);
      packet.set(new Uint8Array(data), HEADER_BYTES);
      send(packet);

      offset = after;
      onProgress(offset);
    }
    send(JSON.stringify({ t: 'end', tid } satisfies Control<H>));
    onProgress(offset, true);
  } catch (e) {
    send(JSON.stringify({ t: 'abort', tid } satisfies Control<H>));
    throw e;
  }
}

interface Incoming<H> {
  header: H;
  meta: FileMeta;
  parts: Blob[];
  pending: Uint8Array[];
  pendingBytes: number;
  received: number;
  progress: (done: number, force?: boolean) => void;
}

export interface ReceiverEvents<H> {
  onStart: (header: H, meta: FileMeta) => (done: number, force?: boolean) => void;
  onComplete: (header: H, meta: FileMeta, blob: Blob) => void;
  onAbort: (header: H) => void;
}

// Reassembles files arriving on one peer's file channel.
export function receiveFilesOn<H>(ch: RTCDataChannel, events: ReceiverEvents<H>): () => void {
  const incoming = new Map<number, Incoming<H>>();

  const flush = (f: Incoming<H>) => {
    if (!f.pending.length) return;
    f.parts.push(new Blob(f.pending as BlobPart[]));
    f.pending = [];
    f.pendingBytes = 0;
  };

  ch.addEventListener('message', (e: MessageEvent) => {
    if (typeof e.data === 'string') {
      let msg: Control<H>;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'start') {
        const progress = events.onStart(msg.header, msg.file);
        incoming.set(msg.tid, { header: msg.header, meta: msg.file, parts: [], pending: [], pendingBytes: 0, received: 0, progress });
      } else {
        const f = incoming.get(msg.tid);
        if (!f) return;
        incoming.delete(msg.tid);
        if (msg.t === 'end') {
          flush(f);
          events.onComplete(f.header, f.meta, new Blob(f.parts, { type: f.meta.mime }));
        } else {
          events.onAbort(f.header);
        }
      }
      return;
    }

    const buf = e.data as ArrayBuffer;
    if (buf.byteLength < HEADER_BYTES) return;
    const f = incoming.get(new DataView(buf).getUint32(0));
    if (!f) return;
    const bytes = new Uint8Array(buf, HEADER_BYTES);
    f.pending.push(bytes);
    f.pendingBytes += bytes.byteLength;
    f.received += bytes.byteLength;
    if (f.pendingBytes >= FLUSH_BYTES) flush(f);
    f.progress(f.received);
  });

  // Called when the peer goes away: whatever was half-received is abandoned.
  return () => {
    for (const f of incoming.values()) events.onAbort(f.header);
    incoming.clear();
  };
}
