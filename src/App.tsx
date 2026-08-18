import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { db, type Identity, type RecentRoom, type StoredMessage } from './db.ts';
import { Mesh, type RosterMember } from './mesh.ts';
import ChatScreen from './ChatScreen.tsx';
import WelcomePage from './pages/WelcomePage.tsx';
import CreateRoomPage from './pages/CreateRoomPage.tsx';
import JoinRoomPage from './pages/JoinRoomPage.tsx';
import { requestNotificationPermission, showMessageNotification } from './notify.ts';
import { clearActiveSession, loadActiveSession, saveActiveSession } from './session.ts';

function describeError(err: (Error & { type?: string }) | Error): string {
  const type = (err as { type?: string }).type;
  if (type === 'unavailable-id') return 'That room code is taken or you already have a session open. Try another code.';
  if (type === 'peer-unavailable') return 'No room found with that code. Check with whoever created it.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Could not reach the signaling relay. Check your internet connection.';
  if (err.message) return err.message;
  return 'Something went wrong. Please try again.';
}

export default function App() {
  const navigate = useNavigate();

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);

  const [roomCode, setRoomCode] = useState('');
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [currentThread, setCurrentThread] = useState('global');
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [onlineVersion, setOnlineVersion] = useState(0);
  const [messageInput, setMessageInput] = useState('');

  const meshRef = useRef<Mesh | null>(null);
  const currentThreadRef = useRef(currentThread);
  const roomCodeRef = useRef(roomCode);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  currentThreadRef.current = currentThread;
  roomCodeRef.current = roomCode;

  useEffect(() => {
    (async () => {
      const id = await db.getIdentity();
      if (id) setNameInput(id.name);
      setIdentity(id);
      setRecentRooms(await db.getRecentRooms());

      const session = id ? loadActiveSession() : null;
      if (session) {
        await handleEnterRoom(session.mode, session.roomCode, id!);
      }
      setBootstrapping(false);
    })();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  useEffect(() => {
    if (!roomCode) return;
    // Refreshing or closing the tab always drops the live WebRTC session -
    // there's no server to restore it from - so warn before that happens.
    // Browsers show their own fixed wording here; the message text is ignored.
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [roomCode]);

  async function loadThreadMessages(code: string, threadId: string) {
    const msgs = await db.getThreadMessages(code, threadId);
    msgs.sort((a, b) => a.ts - b.ts);
    setMessages(msgs);
  }

  async function ensureIdentity(): Promise<Identity> {
    const name = nameInput.trim();
    if (!name) throw new Error('Enter your name first.');
    let current = identity;
    if (!current) {
      current = { deviceId: crypto.randomUUID(), name };
    } else if (current.name !== name) {
      current = { ...current, name };
    }
    await db.saveIdentity(current);
    setIdentity(current);
    return current;
  }

  async function handleEnterRoom(mode: 'create' | 'join', codeRaw: string, presetIdentity?: Identity) {
    setError('');
    const code = codeRaw.trim();
    if (!code) {
      setError('Enter a room code.');
      return;
    }

    // Fire from this click handler (a user gesture) rather than later, since
    // some browsers only honor the permission prompt tied to direct input.
    // Skipped on an automatic rejoin-after-refresh - there's no click to hang it on.
    if (!presetIdentity) void requestNotificationPermission();

    let id: Identity;
    if (presetIdentity) {
      id = presetIdentity;
    } else {
      try {
        id = await ensureIdentity();
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }

    setBusy(true);

    const mesh = new Mesh(id.deviceId, id.name, {
      onRoster: (members) => {
        setRoster(members.filter((m) => m.id !== mesh.myId));
      },
      onMessage: async (data) => {
        const threadId = data.scope === 'global' ? 'global' : data.from;
        await db.addMessage({
          roomCode: roomCodeRef.current,
          threadId,
          senderId: data.from,
          senderName: data.fromName,
          text: data.text,
          ts: data.ts,
          self: false,
        });
        if (threadId === currentThreadRef.current) {
          await loadThreadMessages(roomCodeRef.current, threadId);
        } else {
          setUnread((u) => ({ ...u, [threadId]: (u[threadId] || 0) + 1 }));
        }
        // Only alert when the message wouldn't already be visible: tab
        // backgrounded, or a different thread is open.
        if (document.hidden || threadId !== currentThreadRef.current) {
          showMessageNotification({
            title: data.scope === 'global' ? `${data.fromName} · Global Chat` : data.fromName,
            body: data.text,
            onClick: () => selectThread(threadId),
          });
        }
      },
      onStatus: () => setOnlineVersion((v) => v + 1),
      onError: (err) => {
        console.error('mesh error', err);
        if (!meshRef.current) {
          setError(describeError(err));
        }
      },
    });

    try {
      if (mode === 'create') {
        await mesh.createRoom(code);
      } else {
        await mesh.joinRoom(code);
      }
      meshRef.current = mesh;
      roomCodeRef.current = code;
      setRoomCode(code);
      await db.touchRoom(code);
      setRecentRooms(await db.getRecentRooms());
      setCurrentThread('global');
      currentThreadRef.current = 'global';
      await loadThreadMessages(code, 'global');
      saveActiveSession({ roomCode: code, mode });
      navigate('/chat', { replace: true });
    } catch (e) {
      console.error(e);
      setError(describeError(e as Error));
      // The underlying PeerJS connection may already be registered under our
      // deviceId even though the create/join failed - tear it down so a
      // retry doesn't collide with this dangling registration.
      mesh.leave();
      // Don't keep retrying a broken session on every future load.
      clearActiveSession();
    } finally {
      setBusy(false);
    }
  }

  async function selectThread(threadId: string) {
    setCurrentThread(threadId);
    currentThreadRef.current = threadId;
    setUnread((u) => {
      const next = { ...u };
      delete next[threadId];
      return next;
    });
    await loadThreadMessages(roomCodeRef.current, threadId);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = messageInput.trim();
    const mesh = meshRef.current;
    if (!text || !mesh) return;
    setMessageInput('');

    const msg = currentThread === 'global' ? mesh.sendGlobal(text) : mesh.sendDirect(currentThread, text);

    await db.addMessage({
      roomCode: roomCodeRef.current,
      threadId: currentThread,
      senderId: msg.from,
      senderName: identity!.name,
      text: msg.text,
      ts: msg.ts,
      self: true,
    });
    await loadThreadMessages(roomCodeRef.current, currentThread);
  }

  function handleLeave() {
    meshRef.current?.leave();
    meshRef.current = null;
    setRoomCode('');
    setCurrentThread('global');
    setRoster([]);
    setUnread({});
    setMessages([]);
    setError('');
    clearActiveSession();
    navigate('/');
  }

  if (bootstrapping) {
    return (
      <div className="screen setup-screen">
        <div className="setup-card bootstrap-card">
          <span className="spinner bootstrap-spinner" />
          <p className="tagline">Reconnecting…</p>
        </div>
      </div>
    );
  }

  if (roomCode && identity) {
    return (
      <ChatScreen
        identity={identity}
        roomCode={roomCode}
        roster={roster}
        currentThread={currentThread}
        messages={messages}
        unread={unread}
        mesh={meshRef.current}
        onlineVersion={onlineVersion}
        messageInput={messageInput}
        setMessageInput={setMessageInput}
        onSelectThread={selectThread}
        onSend={handleSend}
        onLeave={handleLeave}
        messagesEndRef={messagesEndRef}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<WelcomePage recentRooms={recentRooms} />} />
      <Route
        path="/create"
        element={
          <CreateRoomPage
            nameInput={nameInput}
            setNameInput={setNameInput}
            busy={busy}
            error={error}
            onSubmit={(code) => handleEnterRoom('create', code)}
          />
        }
      />
      <Route
        path="/join"
        element={
          <JoinRoomPage
            nameInput={nameInput}
            setNameInput={setNameInput}
            busy={busy}
            error={error}
            onSubmit={(code) => handleEnterRoom('join', code)}
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
