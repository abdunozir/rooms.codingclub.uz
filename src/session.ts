// Tracks which room the user is currently in, purely so a page refresh can
// automatically rejoin it. This is separate from db.ts's "recent rooms" list
// (a history of rooms ever joined) - this is just "am I in one right now."

const KEY = 'wifichat:active-room';

export interface ActiveSession {
  roomCode: string;
  mode: 'create' | 'join';
}

export function saveActiveSession(session: ActiveSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function loadActiveSession(): ActiveSession | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.roomCode === 'string' && (parsed.mode === 'create' || parsed.mode === 'join')) {
      return parsed;
    }
  } catch {
    /* ignore malformed value */
  }
  return null;
}

export function clearActiveSession(): void {
  localStorage.removeItem(KEY);
}
