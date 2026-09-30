import { useEffect, useRef, useState } from 'react';
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

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

// Shows the first frame with a play button and duration badge, like a
// thumbnail; the browser's controls only appear once it's actually playing.
function VideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [started, setStarted] = useState(false);
  const [duration, setDuration] = useState(0);

  function start() {
    const v = videoRef.current;
    if (!v) return;
    setStarted(true);
    v.currentTime = 0;
    void v.play();
  }

  return (
    <div className={'att-media att-video' + (started ? ' started' : '')}>
      {/* The #t fragment makes browsers decode and paint the first frame. */}
      <video
        ref={videoRef}
        src={src + '#t=0.1'}
        controls={started}
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
      {!started && (
        <button type="button" className="video-overlay" onClick={start} aria-label="Play video">
          <span className="video-play">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
              <path d="M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z" />
            </svg>
          </span>
          {Number.isFinite(duration) && duration > 0 && <span className="video-duration">{formatTime(duration)}</span>}
        </button>
      )}
    </div>
  );
}

// Styled to match the bubbles instead of the browser's own (white, cramped)
// audio control.
function AudioPlayer({ src, name }: { src: string; name: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  // Chrome's MediaRecorder writes webm without a duration header, so such
  // files report Infinity until the browser has seeked to the end once.
  const probing = useRef(false);

  function handleLoadedMetadata() {
    const a = audioRef.current!;
    if (Number.isFinite(a.duration)) {
      setDuration(a.duration);
    } else {
      probing.current = true;
      a.currentTime = 1e101;
    }
  }

  function handleDurationChange() {
    const a = audioRef.current!;
    if (!Number.isFinite(a.duration)) return;
    setDuration(a.duration);
    if (probing.current) {
      probing.current = false;
      a.currentTime = 0;
    }
  }

  function handleTimeUpdate() {
    if (!probing.current) setCurrent(audioRef.current!.currentTime);
  }

  function toggle() {
    const a = audioRef.current!;
    if (a.paused) void a.play();
    else a.pause();
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const a = audioRef.current!;
    const t = Number(e.target.value);
    a.currentTime = t;
    setCurrent(t);
  }

  const pct = duration ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className="att-audio">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleDurationChange}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      />
      <button type="button" className="audio-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z" />
          </svg>
        )}
      </button>
      <div className="audio-body">
        <input
          type="range"
          className="audio-seek"
          min={0}
          max={duration || 0}
          step="any"
          value={current}
          onChange={seek}
          disabled={!duration}
          aria-label={`Seek ${name}`}
          style={{ '--pct': pct + '%' } as React.CSSProperties}
        />
        <span className="audio-time">
          {playing || current > 0 ? `${formatTime(current)} / ${formatTime(duration)}` : formatTime(duration)}
        </span>
      </div>
    </div>
  );
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
      return <VideoPlayer src={url} />;
    case 'audio':
      return <AudioPlayer src={url} name={attachment.name} />;
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
