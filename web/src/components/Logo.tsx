/**
 * The Foxbloom mark, drawn exactly like the browser-tab icon (index.html), the tray icon and the installer icon:
 * a rose tile with a plum fox face (rose eyes) and a little five-petal bloom on its forehead.
 */
export const FOX_HEAD = 'M6 6L13.5 12.5H18.5L26 6L24.6 17C24.1 22.6 20.3 26.4 16 27.5C11.7 26.4 7.9 22.6 7.4 17Z';
const PETALS = [0, 72, 144, 216, 288].map((a) => {
  const r = (a - 90) * (Math.PI / 180);
  return [16 + Math.cos(r) * 1.55, 16.2 + Math.sin(r) * 1.55] as const;
});

export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#f2a7c3" />
      <path d={FOX_HEAD} fill="#2a1024" />
      <ellipse cx="12.4" cy="20" rx="1.6" ry="1.15" fill="#f2a7c3" />
      <ellipse cx="19.6" cy="20" rx="1.6" ry="1.15" fill="#f2a7c3" />
      {PETALS.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.15" fill="#f7c6d8" />
      ))}
      <circle cx="16" cy="16.2" r="0.75" fill="#2a1024" />
    </svg>
  );
}
