import { Link, useNavigate } from 'react-router-dom';
import type { RecentRoom } from '../db.ts';

interface Props {
  recentRooms: RecentRoom[];
}

export default function WelcomePage({ recentRooms }: Props) {
  const navigate = useNavigate();

  return (
    <div className="screen setup-screen">
      <div className="setup-card">
        <h1>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle className="wifi-dot" cx="12" cy="18" r="1.6" />
              <path className="wifi-arc wifi-arc-1" d="M8.5 14.5a5 5 0 0 1 7 0" />
              <path className="wifi-arc wifi-arc-2" d="M5.5 11.2a9.2 9.2 0 0 1 13 0" />
              <path className="wifi-arc wifi-arc-3" d="M2.5 8a13.5 13.5 0 0 1 19 0" />
            </svg>
          </span>
          WifiChat
        </h1>
        <p className="tagline">
          Serverless chat. Messages travel device-to-device once you're connected — nothing is stored anywhere but your own devices.
        </p>

        <div className="choice-actions">
          <Link to="/create" className="btn primary choice-btn">
            Create a room
          </Link>
          <Link to="/join" className="btn choice-btn">
            Join a room
          </Link>
        </div>

        {recentRooms.length > 0 && (
          <div className="recent-rooms">
            <h3>Recent rooms</h3>
            <div className="recent-rooms-list">
              {recentRooms.slice(0, 8).map((r) => (
                <button
                  key={r.roomCode}
                  className="recent-room-chip"
                  onClick={() => navigate('/join', { state: { code: r.roomCode } })}
                >
                  {r.roomCode}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
