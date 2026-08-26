import { useLayoutEffect, useRef } from 'react';
import type { Identity, StoredMessage } from './db.ts';
import type { Mesh, RosterMember } from './mesh.ts';
import { avatarAccentColor, avatarGradient, initials } from './avatar.ts';
import { FORMAT_MARKERS, renderRichText } from './richText.tsx';

interface Props {
  identity: Identity;
  roomCode: string;
  roster: RosterMember[];
  currentThread: string;
  // On mobile, sidebar and conversation are two full-screen panes rather than
  // side-by-side columns; this says which one is the route currently on.
  showConversation: boolean;
  messages: StoredMessage[];
  unread: Record<string, number>;
  mesh: Mesh | null;
  onlineVersion: number;
  messageInput: string;
  setMessageInput: (v: string) => void;
  onSelectThread: (threadId: string) => void;
  onBackToList: () => void;
  onSend: (e: React.SyntheticEvent<HTMLFormElement>) => void;
  onLeave: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

function Avatar({ seed, label, size = 36 }: { seed: string; label: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ background: avatarGradient(seed), width: size, height: size, fontSize: size * 0.4 }}
    >
      {label}
    </span>
  );
}

export default function ChatScreen({
  identity,
  roomCode,
  roster,
  currentThread,
  showConversation,
  messages,
  unread,
  mesh,
  onlineVersion,
  messageInput,
  setMessageInput,
  onSelectThread,
  onBackToList,
  onSend,
  onLeave,
  messagesEndRef,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Selection to reapply after a formatting edit re-renders the textarea.
  const pendingSelection = useRef<[number, number] | null>(null);
  // Desktop: Enter sends, Shift+Enter adds a line. Touch keyboards have no
  // Shift, so there Enter just adds a line and the send button sends.
  const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // Auto-grow the composer with its content, up to a few lines.
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 132) + 'px';
    // Reapply the caret/selection after a formatting button rewrote the value.
    const sel = pendingSelection.current;
    if (sel) {
      pendingSelection.current = null;
      el.focus();
      el.setSelectionRange(sel[0], sel[1]);
    }
  }, [messageInput]);

  function wrapSelection(marker: string) {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = messageInput;
    const chosen = value.slice(start, end);
    const next = value.slice(0, start) + marker + chosen + marker + value.slice(end);
    pendingSelection.current = start === end ? [start + marker.length, start + marker.length] : [start + marker.length, end + marker.length];
    setMessageInput(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        wrapSelection(FORMAT_MARKERS.bold);
        return;
      }
      if (key === 'i') {
        e.preventDefault();
        wrapSelection(FORMAT_MARKERS.italic);
        return;
      }
      if (key === 'u') {
        e.preventDefault();
        wrapSelection(FORMAT_MARKERS.underline);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !isTouch && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  const activePeer = roster.find((m) => m.id === currentThread);
  const isGlobal = currentThread === 'global';
  const threadTitle = isGlobal ? 'Global Chat' : (activePeer?.name ?? 'Unknown device');
  const peerOnline = !isGlobal && (mesh?.isPeerOnline(currentThread) ?? false);
  const threadStatus = isGlobal ? `${roster.length + 1} member${roster.length === 0 ? '' : 's'}` : peerOnline ? 'online' : 'offline';

  return (
    <div className="screen chat-screen">
      <aside className={'sidebar' + (showConversation ? ' mobile-hidden' : '')}>
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
          <button className={'thread-item' + (isGlobal ? ' active' : '')} onClick={() => onSelectThread('global')}>
            <span className="avatar avatar-global">🌐</span>
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
                <span className="avatar-wrap">
                  <Avatar seed={m.id} label={initials(m.name)} size={32} />
                  <span className={'status-dot ' + (online ? 'online' : 'offline')}></span>
                </span>
                <span className="thread-name">{m.name}</span>
                {unread[m.id] > 0 && <span className="unread-badge">{unread[m.id]}</span>}
              </button>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <span className="avatar-wrap">
            <Avatar seed={identity.deviceId} label={initials(identity.name)} size={28} />
            <span className="status-dot online"></span>
          </span>
          <span className="me-name">{identity.name}</span>
        </div>
      </aside>

      <main className={'chat-main' + (showConversation ? '' : ' mobile-hidden')}>
        <div className="chat-header">
          <button type="button" className="mobile-back-btn" aria-label="Back to chats" onClick={onBackToList}>
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {isGlobal ? (
            <span className="avatar avatar-global" style={{ width: 36, height: 36 }}>
              🌐
            </span>
          ) : (
            <Avatar seed={currentThread} label={initials(threadTitle)} />
          )}
          <div className="chat-header-text">
            <span id="current-thread-title">{threadTitle}</span>
            <span className={'thread-status' + (peerOnline ? ' online' : '')}>{threadStatus}</span>
          </div>
        </div>

        <div className="messages">
          {messages.length === 0 && <div className="empty-hint">No messages yet. Say hello!</div>}
          {messages.map((m) => {
            const showName = isGlobal && !m.self;
            return (
              <div key={m.id} className={'msg' + (m.self ? ' self' : '')}>
                {showName && (
                  <div className="msg-sender" style={{ color: avatarAccentColor(m.senderId) }}>
                    {m.senderName}
                  </div>
                )}
                <div className="msg-text">
                  {renderRichText(m.text)}
                  <span className="msg-time">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <form className="send-form" onSubmit={onSend}>
          <div className="composer">
            <div className="format-bar" aria-label="Text formatting">
              <button type="button" className="fmt-btn" aria-label="Bold" title="Bold (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection(FORMAT_MARKERS.bold)}>
                <b>B</b>
              </button>
              <button type="button" className="fmt-btn" aria-label="Italic" title="Italic (Ctrl+I)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection(FORMAT_MARKERS.italic)}>
                <i>I</i>
              </button>
              <button type="button" className="fmt-btn" aria-label="Underline" title="Underline (Ctrl+U)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection(FORMAT_MARKERS.underline)}>
                <u>U</u>
              </button>
            </div>
            <textarea
              ref={inputRef}
              className="composer-input"
              placeholder="Message"
              autoComplete="off"
              rows={1}
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <button type="submit" className="send-btn" aria-label="Send message">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d="M3 11.5L20.5 4 13 21.5l-2.8-7.3L3 11.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </button>
        </form>
      </main>
    </div>
  );
}
