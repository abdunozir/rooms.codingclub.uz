import { useEffect, useState } from 'react';
import type { Attachment } from './db.ts';
import { attachmentKind, formatBytes } from './attachments.ts';

// Object URLs pin their Blob in memory until revoked, so each one lives only
// as long as the bubble showing it.
function useObjectUrl(blob: Blob): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export default function MessageAttachment({ attachment }: { attachment: Attachment }) {
  const url = useObjectUrl(attachment.blob);
  if (!url) return null;

  switch (attachmentKind(attachment.mime)) {
    case 'image':
      return (
        <a className="att-media" href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={attachment.name} loading="lazy" />
        </a>
      );
    case 'video':
      return (
        <div className="att-media">
          <video src={url} controls playsInline preload="metadata" />
        </div>
      );
    case 'audio':
      return <audio className="att-audio" src={url} controls preload="metadata" />;
    default:
      return (
        <a className="att-file" href={url} download={attachment.name}>
          <span className="att-file-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />
            </svg>
          </span>
          <span className="att-file-meta">
            <span className="att-file-name">{attachment.name}</span>
            <span className="att-file-size">{formatBytes(attachment.size)}</span>
          </span>
        </a>
      );
  }
}
