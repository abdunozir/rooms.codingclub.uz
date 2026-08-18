export default function BrandHeader() {
  return (
    <h1>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle className="wifi-dot" cx="12" cy="18" r="1.6" />
          <path className="wifi-arc wifi-arc-1" d="M8.5 14.5a5 5 0 0 1 7 0" />
          <path className="wifi-arc wifi-arc-2" d="M5.5 11.2a9.2 9.2 0 0 1 13 0" />
          <path className="wifi-arc wifi-arc-3" d="M2.5 8a13.5 13.5 0 0 1 19 0" />
        </svg>
      </span>
      WifiChat
    </h1>
  );
}
