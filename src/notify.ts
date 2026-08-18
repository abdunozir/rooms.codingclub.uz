// Local notifications only - there's no server here to run a push service, so
// this can't wake up a closed tab. Instead we surface a native notification
// the instant a message arrives over the already-open WebRTC connection,
// whenever the tab is backgrounded or a different thread is open.

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  return Notification.permission;
}

export function showMessageNotification(opts: { title: string; body: string; onClick?: () => void }): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const n = new Notification(opts.title, {
    body: opts.body,
    icon: '/favicon.svg',
    tag: 'wifichat-message',
  });

  n.onclick = () => {
    window.focus();
    opts.onClick?.();
    n.close();
  };
}
