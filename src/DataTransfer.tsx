import { useRef, useState } from 'react';
import { db } from './db.ts';

interface Props {
  // Called after a successful import so the caller can refresh anything it
  // derives from the database (e.g. the recent-rooms list).
  onImported: () => void;
}

type Status = { kind: 'ok' | 'err'; text: string } | null;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export default function DataTransfer({ onImported }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setStatus(null);
    setBusy(true);
    try {
      const bundle = await db.exportAll();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wifichat-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus({ kind: 'ok', text: `Exported ${plural(bundle.messages.length, 'message')} from ${plural(bundle.rooms.length, 'room')}.` });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message || 'Export failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again later
    if (!file) return;
    setStatus(null);
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      const result = await db.importAll(parsed);
      const parts = [plural(result.messages, 'new message')];
      if (result.rooms > 0) parts.push(plural(result.rooms, 'new room'));
      if (result.identitySet) parts.push('your saved name');
      const summary =
        result.messages === 0 && result.rooms === 0 && !result.identitySet
          ? 'Nothing new to import — this device already has everything in that file.'
          : `Imported ${parts.join(', ')}. Open a room to see its messages.`;
      setStatus({ kind: 'ok', text: summary });
      onImported();
    } catch (e) {
      const msg = e instanceof Error && e.message.startsWith('Not a valid') ? e.message : 'Could not read that file. Pick a WifiChat backup exported from this app.';
      setStatus({ kind: 'err', text: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="data-transfer">
      <h3>Your data</h3>
      <p className="data-transfer-hint">
        Chats are stored only on this device and survive page refreshes. Export a backup to keep them safe or move them to another device, then import it there.
      </p>
      <div className="data-transfer-actions">
        <button type="button" className="btn small" onClick={handleExport} disabled={busy}>
          Export backup
        </button>
        <button type="button" className="btn small" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy && <span className="spinner" />}
          Import backup
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={handleFile} />
      </div>
      {status && <p className={status.kind === 'ok' ? 'data-transfer-ok' : 'error'}>{status.text}</p>}
    </div>
  );
}
