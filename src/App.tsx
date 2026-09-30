import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { db, type Identity, type RecentRoom, type StoredMessage } from './db.ts';
import { Mesh, type RosterMember, type TransferProgress } from './mesh.ts';
import RoomView from './RoomView.tsx';
import CreateRoomPage from './pages/CreateRoomPage.tsx';
import JoinRoomPage from './pages/JoinRoomPage.tsx';
import { requestNotificationPermission, showMessageNotification } from './notify.ts';
import { stripRichText } from './richText.tsx';
import { attachmentLabel, MAX_ATTACHMENT_BYTES, formatBytes } from './attachments.ts';
import { clearActiveSession, loadActiveSession, saveActiveSession } from './session.ts';
import { threadPath } from './routes.ts';

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
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [onlineVersion, setOnlineVersion] = useState(0);
  const [messageInput, setMessageInput] = useState('');
  // Files currently streaming in or out, keyed by msgId.
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});

  const meshRef = useRef<Mesh | null>(null);
  // Which thread is open lives in the URL (see RoomView), not React state;
  // this ref just gives the mesh's message callback a synchronous read of it.
  const currentThreadRef = useRef('global');
  const roomCodeRef = useRef(roomCode);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
        const att = data.attachment;
        await db.addMessage({
          roomCode: roomCodeRef.current,
          threadId,
          senderId: data.from,
          senderName: data.fromName,
          text: data.text,
          ts: data.ts,
          self: false,
          attachment: att,
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
            body: att ? [attachmentLabel(att.mime, att.name), stripRichText(data.text)].filter(Boolean).join(' · ') : stripRichText(data.text),
            onClick: () => navigate(threadPath(roomCodeRef.current, threadId)),
          });
        }
      },
      onStatus: () => setOnlineVersion((v) => v + 1),
      onTransfer: (p) => {
        setTransfers((t) => {
          if ('finished' in p) {
            if (!(p.msgId in t)) return t;
            const next = { ...t };
            delete next[p.msgId];
            return next;
          }
          return { ...t, [p.msgId]: p };
        });
      },
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
      currentThreadRef.current = 'global';
      await loadThreadMessages(code, 'global');
      saveActiveSession({ roomCode: code, mode });
      navigate(`/room/${code}`, { replace: true });
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

  function handleThreadChange(threadId: string) {
    currentThreadRef.current = threadId;
    setUnread((u) => {
      if (!(threadId in u)) return u;
      const next = { ...u };
      delete next[threadId];
      return next;
    });
    void loadThreadMessages(roomCodeRef.current, threadId);
  }

  async function handleSend(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = messageInput.trim();
    const mesh = meshRef.current;
    if (!text || !mesh) return;
    setMessageInput('');

    const thread = currentThreadRef.current;
    const msg = thread === 'global' ? mesh.sendGlobal(text) : mesh.sendDirect(thread, text);

    await db.addMessage({
      roomCode: roomCodeRef.current,
      threadId: thread,
      senderId: msg.from,
      senderName: identity!.name,
      text: msg.text,
      ts: msg.ts,
      self: true,
    });
    await loadThreadMessages(roomCodeRef.current, thread);
  }

  // Sends a picked file or recorded voice note, with an optional caption.
  // Resolves once the whole file has been streamed out.
  async function handleSendFile(file: Blob, name: string, caption: string) {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
    }
    const mime = file.type || 'application/octet-stream';
    const thread = currentThreadRef.current;
    const { header, done } = mesh.sendFile(thread, caption, file, { name, mime, size: file.size });

    // Store and show the message right away; the bytes keep streaming below.
    await db.addMessage({
      roomCode: roomCodeRef.current,
      threadId: thread,
      senderId: header.from,
      senderName: identity!.name,
      text: caption,
      ts: header.ts,
      self: true,
      attachment: { name, mime, size: file.size, blob: file },
    });
    await loadThreadMessages(roomCodeRef.current, thread);
    await done;
  }

  function handleLeave() {
    meshRef.current?.leave();
    meshRef.current = null;
    setRoomCode('');
    setRoster([]);
    setUnread({});
    setTransfers({});
    setMessages([]);
    setError('');
    clearActiveSession();
    navigate('/');
  }

  // After a backup is imported, pull the freshly-merged data back into view:
  // the recent-rooms list, the saved name, and - if we're in a room - the
  // currently open thread (imported history for it should show right away).
  async function handleDataImported() {
    setRecentRooms(await db.getRecentRooms());
    const id = await db.getIdentity();
    if (id) {
      setIdentity(id);
      setNameInput(id.name);
    }
    if (roomCodeRef.current) {
      await loadThreadMessages(roomCodeRef.current, currentThreadRef.current);
    }
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

  const joinPage = (
    <JoinRoomPage
      nameInput={nameInput}
      setNameInput={setNameInput}
      busy={busy}
      error={error}
      recentRooms={recentRooms}
      onSubmit={(code) => handleEnterRoom('join', code)}
      onImported={handleDataImported}
    />
  );

  const roomView = (
    <RoomView
      identity={identity}
      connectedRoomCode={roomCode}
      roster={roster}
      messages={messages}
      unread={unread}
      mesh={meshRef.current}
      onlineVersion={onlineVersion}
      messageInput={messageInput}
      setMessageInput={setMessageInput}
      onThreadChange={handleThreadChange}
      onSend={handleSend}
      onSendFile={handleSendFile}
      transfers={transfers}
      onLeave={handleLeave}
      onImported={handleDataImported}
      messagesEndRef={messagesEndRef}
    />
  );

  return (
    <Routes>
      <Route path="/" element={joinPage} />
      <Route path="/join" element={joinPage} />
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
      <Route path="/room/:roomCode" element={roomView} />
      <Route path="/room/:roomCode/:chatId" element={roomView} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
