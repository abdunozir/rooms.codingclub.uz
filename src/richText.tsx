import type { ReactNode } from 'react';

// Lightweight inline formatting for chat messages. Messages travel the wire as
// plain strings carrying these markers; both the composer (which inserts them)
// and this renderer agree on the syntax, so nothing about the mesh protocol
// changes.
//
//   *bold*      ->  <strong>
//   _italic_    ->  <em>
//   ~underline~ ->  <u>
//
// Markers nest (`*_both_*`) and may span newlines. Literal line breaks in the
// text render as-is via the `white-space: pre-wrap` on `.msg-text`.

export const FORMAT_MARKERS = { bold: '*', italic: '_', underline: '~' } as const;

// Each pair only counts when there's non-space just inside both ends, so
// "2 * 3 * 4" stays literal. `_` additionally needs a non-word char on the
// outside of each marker so `snake_case_name` isn't mangled - matching how
// Telegram/WhatsApp treat the same characters.
const RULES: { re: RegExp; tag: 'strong' | 'em' | 'u' }[] = [
  { re: /\*(?=\S)([\s\S]*?\S)\*/, tag: 'strong' },
  { re: /(?<!\w)_(?=\S)([\s\S]*?\S)_(?!\w)/, tag: 'em' },
  { re: /~(?=\S)([\s\S]*?\S)~/, tag: 'u' },
];

interface Hit {
  index: number;
  length: number;
  inner: string;
  tag: 'strong' | 'em' | 'u';
}

function firstHit(text: string): Hit | null {
  let best: Hit | null = null;
  for (const { re, tag } of RULES) {
    const m = re.exec(text);
    if (!m) continue;
    if (!best || m.index < best.index) {
      best = { index: m.index, length: m[0].length, inner: m[1], tag };
    }
  }
  return best;
}

export function renderRichText(text: string, keyPrefix = 'f'): ReactNode {
  const nodes: ReactNode[] = [];
  let rest = text;
  let i = 0;

  while (rest.length > 0) {
    const hit = firstHit(rest);
    if (!hit) {
      nodes.push(rest);
      break;
    }
    if (hit.index > 0) nodes.push(rest.slice(0, hit.index));

    const Tag = hit.tag;
    const key = `${keyPrefix}${i}`;
    nodes.push(<Tag key={key}>{renderRichText(hit.inner, `${key}-`)}</Tag>);

    rest = rest.slice(hit.index + hit.length);
    i += 1;
  }

  return nodes;
}

// Plain-text version for places that can't render markup (OS notifications).
export function stripRichText(text: string): string {
  const hit = firstHit(text);
  if (!hit) return text;
  return text.slice(0, hit.index) + stripRichText(hit.inner) + stripRichText(text.slice(hit.index + hit.length));
}
