import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface Props {
  nameInput: string;
  setNameInput: (v: string) => void;
  busy: boolean;
  error: string;
  onSubmit: (code: string) => void;
}

export default function JoinRoomPage({ nameInput, setNameInput, busy, error, onSubmit }: Props) {
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
        <Link to="/" className="back-link">
          ← Back
        </Link>
        <h1>Join a room</h1>
        <p className="tagline">Enter the room code someone shared with you. You'll connect directly to the other devices over WiFi.</p>

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
            {busy ? 'Joining…' : 'Join room'}
          </button>

          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
