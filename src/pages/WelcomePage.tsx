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
        <h1>WifiChat</h1>
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
