import { useEffect, useRef, useState } from 'react';
import { db } from './db.ts';

interface Props {
  // Called after a successful import so the caller can refresh anything it
  // derives from the database (recent-rooms list, the open thread, identity).
  onImported: () => void;
  // "panel" - full section for the setup screen. "compact" - two icon buttons
  // for the in-room sidebar, with a self-dismissing status line.
  variant?: 'panel' | 'compact';
}

type Status = { kind: 'ok' | 'err'; text: string } | null;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export default function DataTransfer({ onImported, variant = 'panel' }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  // In the sidebar the status has nowhere permanent to live, so fade it out.
  useEffect(() => {
    if (variant !== 'compact' || !status) return;
    const t = setTimeout(() => setStatus(null), 7000);
    return () => clearTimeout(t);
  }, [status, variant]);

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
      setStatus({ kind: 'ok', text: `Saved ${plural(bundle.messages.length, 'message')} from ${plural(bundle.rooms.length, 'room')}.` });
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
          ? 'Nothing new — this device already has everything in that file.'
          : `Imported ${parts.join(', ')}.`;
      setStatus({ kind: 'ok', text: summary });
      onImported();
    } catch (e) {
      const msg = e instanceof Error && e.message.startsWith('Not a valid') ? e.message : 'Could not read that file. Pick a WifiChat backup exported from this app.';
      setStatus({ kind: 'err', text: msg });
    } finally {
      setBusy(false);
    }
  }

  const hiddenInput = <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={handleFile} />;

  if (variant === 'compact') {
    return (
      <div className="data-transfer-compact">
        {status && <span className={'data-toast ' + status.kind}>{status.text}</span>}
        <button type="button" className="icon-btn" onClick={handleExport} disabled={busy} title="Export chats to a file" aria-label="Export chats to a file">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14" />
          </svg>
        </button>
        <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} disabled={busy} title="Import chats from a file" aria-label="Import chats from a file">
          {busy ? (
            <span className="spinner" />
          ) : (
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21V9m0 0l4 4m-4-4l-4 4M5 3h14" />
            </svg>
          )}
        </button>
        {hiddenInput}
      </div>
    );
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
        {hiddenInput}
      </div>
      {status && <p className={status.kind === 'ok' ? 'data-transfer-ok' : 'error'}>{status.text}</p>}
    </div>
  );
}
