// The room root (/room/:roomCode, no chatId) is reserved for "nothing open
// yet" - the landing pane on mobile and the back-button target. Every actual
// thread, including Global Chat, gets its own segment so selecting it always
// switches mobile into the conversation pane.
export function threadPath(roomCode: string, threadId: string): string {
  return `/room/${roomCode}/${threadId}`;
}
