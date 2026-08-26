import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import BrandHeader from '../BrandHeader.tsx';
import DataTransfer from '../DataTransfer.tsx';
import type { RecentRoom } from '../db.ts';

interface Props {
  nameInput: string;
  setNameInput: (v: string) => void;
  busy: boolean;
  error: string;
  recentRooms: RecentRoom[];
  onSubmit: (code: string) => void;
  onImported: () => void;
}

export default function JoinRoomPage({ nameInput, setNameInput, busy, error, recentRooms, onSubmit, onImported }: Props) {
  const location = useLocation();
  const prefill = (location.state as { code?: string } | null)?.code ?? '';
  const [code, setCode] = useState(prefill);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(code);
  }

  return (
    <div className="screen setup-screen">
      <div className="setup-card">
        <BrandHeader />
        <p className="tagline">Serverless chat over WiFi. Enter a room code to connect directly to the other devices.</p>

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Your name</span>
            <input type="text" maxLength={24} placeholder="e.g. Alex" value={nameInput} onChange={(e) => setNameInput(e.target.value)} autoFocus={!prefill} />
          </label>

          <label className="field">
            <span>Room code</span>
            <input
              type="text"
              maxLength={20}
              placeholder="Enter room code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus={!!prefill}
            />
          </label>

          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" />}
            {busy ? 'Joining…' : 'Join room'}
          </button>

          {error && <p className="error">{error}</p>}
        </form>

        <p className="switch-link">
          Starting a new room? <Link to="/create">Create one instead</Link>
        </p>

        {recentRooms.length > 0 && (
          <div className="recent-rooms">
            <h3>Recent rooms</h3>
            <div className="recent-rooms-list">
              {recentRooms.slice(0, 8).map((r) => (
                <button key={r.roomCode} className="recent-room-chip" onClick={() => setCode(r.roomCode)}>
                  {r.roomCode}
                </button>
              ))}
            </div>
          </div>
        )}

        <DataTransfer onImported={onImported} />
      </div>
    </div>
  );
}
