import { useState } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  nameInput: string;
  setNameInput: (v: string) => void;
  busy: boolean;
  error: string;
  onSubmit: (code: string) => void;
}

export default function CreateRoomPage({ nameInput, setNameInput, busy, error, onSubmit }: Props) {
  const [code, setCode] = useState('');

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
        <h1>Create a room</h1>
        <p className="tagline">Pick a room code and share it with the other devices. Anyone with the code can join over WiFi.</p>

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Your name</span>
            <input type="text" maxLength={24} placeholder="e.g. Alex" value={nameInput} onChange={(e) => setNameInput(e.target.value)} autoFocus />
          </label>

          <label className="field">
            <span>Room code</span>
            <input type="text" maxLength={20} placeholder="Pick a room code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>

          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" />}
            {busy ? 'Creating…' : 'Create room'}
          </button>

          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
