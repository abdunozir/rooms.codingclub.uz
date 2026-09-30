// Everything travels peer-to-peer over a WebRTC data channel and is held in
// memory on both ends while it does, so keep single files to a sane size.
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export function attachmentKind(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Short plain-text stand-in for an attachment, for notifications.
export function attachmentLabel(mime: string, name: string): string {
  switch (attachmentKind(mime)) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎬 Video';
    case 'audio':
      return '🎤 Audio';
    default:
      return `📎 ${name}`;
  }
}
