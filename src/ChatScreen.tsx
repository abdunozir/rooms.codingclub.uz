import type { Identity, StoredMessage } from './db.ts';
import type { Mesh, RosterMember } from './mesh.ts';

interface Props {
  identity: Identity;
  roomCode: string;
  roster: RosterMember[];
  currentThread: string;
  messages: StoredMessage[];
  unread: Record<string, number>;
  mesh: Mesh | null;
  onlineVersion: number;
  messageInput: string;
  setMessageInput: (v: string) => void;
  onSelectThread: (threadId: string) => void;
  onSend: (e: React.FormEvent) => void;
  onLeave: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export default function ChatScreen({
  identity,
  roomCode,
  roster,
  currentThread,
  messages,
  unread,
  mesh,
  onlineVersion,
  messageInput,
  setMessageInput,
  onSelectThread,
  onSend,
  onLeave,
  messagesEndRef,
}: Props) {
  const activePeer = roster.find((m) => m.id === currentThread);
  const threadTitle = currentThread === 'global' ? 'Global Chat' : (activePeer?.name ?? 'Unknown device');
  const threadStatus =
    currentThread === 'global' ? `${roster.length + 1} device(s) in room` : mesh?.isPeerOnline(currentThread) ? 'online' : 'offline';

  return (
    <div className="screen chat-screen">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <div className="room-label">Room</div>
            <div className="room-code">{roomCode}</div>
          </div>
          <button className="btn small" onClick={onLeave}>
            Leave
          </button>
        </div>

        <div className="thread-list">
          <button className={'thread-item' + (currentThread === 'global' ? ' active' : '')} onClick={() => onSelectThread('global')}>
            <span className="thread-icon">🌐</span>
            <span className="thread-name">Global Chat</span>
            {unread['global'] > 0 && <span className="unread-badge">{unread['global']}</span>}
          </button>

          <div className="thread-section-label">Devices</div>
          {roster.length === 0 && <div className="empty-hint">No other devices yet.</div>}
          {roster.map((m) => {
            const online = mesh?.isPeerOnline(m.id) ?? false;
            void onlineVersion; // re-render on status change
            return (
              <button key={m.id} className={'thread-item' + (currentThread === m.id ? ' active' : '')} onClick={() => onSelectThread(m.id)}>
                <span className={'dot ' + (online ? 'online' : 'offline')}></span>
                <span className="thread-name">{m.name}</span>
                {unread[m.id] > 0 && <span className="unread-badge">{unread[m.id]}</span>}
              </button>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <span>{identity.name}</span>
          <span className="dot online"></span>
        </div>
      </aside>

      <main className="chat-main">
        <div className="chat-header">
          <span id="current-thread-title">{threadTitle}</span>
          <span className="thread-status">{threadStatus}</span>
        </div>

        <div className="messages">
          {messages.length === 0 && <div className="empty-hint">No messages yet. Say hello!</div>}
          {messages.map((m) => (
            <div key={m.id} className={'msg' + (m.self ? ' self' : '')}>
              <div className="msg-meta">
                <span>{m.self ? 'You' : m.senderName}</span>
                <span>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="msg-text">{m.text}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form className="send-form" onSubmit={onSend}>
          <input
            type="text"
            placeholder="Type a message…"
            autoComplete="off"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
          />
          <button type="submit" className="btn primary">
            Send
          </button>
        </form>
      </main>
    </div>
  );
}
