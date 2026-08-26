import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import ChatScreen from './ChatScreen.tsx';
import type { Identity, StoredMessage } from './db.ts';
import type { Mesh, RosterMember } from './mesh.ts';
import { threadPath } from './routes.ts';

interface Props {
  identity: Identity | null;
  connectedRoomCode: string;
  roster: RosterMember[];
  messages: StoredMessage[];
  unread: Record<string, number>;
  mesh: Mesh | null;
  onlineVersion: number;
  messageInput: string;
  setMessageInput: (v: string) => void;
  onThreadChange: (threadId: string) => void;
  onSend: (e: React.SyntheticEvent<HTMLFormElement>) => void;
  onLeave: () => void;
  onImported: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

// The room's chat list and each conversation are real routes
// (/room/:roomCode and /room/:roomCode/:chatId) specifically so the browser's
// own back/forward - including Android's back gesture - navigates between
// them for free, with no manual history bookkeeping.
export default function RoomView(props: Props) {
  const { roomCode, chatId } = useParams<{ roomCode: string; chatId?: string }>();
  const navigate = useNavigate();
  const currentThread = chatId ?? 'global';

  useEffect(() => {
    props.onThreadChange(currentThread);
  }, [currentThread]);

  if (!props.identity || !roomCode || roomCode !== props.connectedRoomCode) {
    return <Navigate to="/" replace />;
  }

  return (
    <ChatScreen
      identity={props.identity}
      roomCode={roomCode}
      roster={props.roster}
      currentThread={currentThread}
      showConversation={!!chatId}
      messages={props.messages}
      unread={props.unread}
      mesh={props.mesh}
      onlineVersion={props.onlineVersion}
      messageInput={props.messageInput}
      setMessageInput={props.setMessageInput}
      onSelectThread={(threadId) => navigate(threadPath(roomCode, threadId))}
      onBackToList={() => navigate(`/room/${roomCode}`)}
      onSend={props.onSend}
      onLeave={props.onLeave}
      onImported={props.onImported}
      messagesEndRef={props.messagesEndRef}
    />
  );
}
