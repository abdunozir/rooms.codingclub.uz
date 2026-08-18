// Telegram-style avatar colors: a small fixed palette, picked deterministically per name/id.
const PALETTE = [
  ['#ff885e', '#ff516a'],
  ['#ffcd6a', '#ffa85c'],
  ['#82b1ff', '#665fff'],
  ['#a0de7e', '#54cb68'],
  ['#53edd6', '#28c9b7'],
  ['#72d5fd', '#2a9ef1'],
  ['#e0a2f3', '#d669ed'],
];

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pick(seed: string): [string, string] {
  return PALETTE[hash(seed) % PALETTE.length] as [string, string];
}

export function avatarGradient(seed: string): string {
  const [a, b] = pick(seed);
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function avatarAccentColor(seed: string): string {
  return pick(seed)[1];
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
