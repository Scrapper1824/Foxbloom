/**
 * The Foxbloom mark, drawn like the browser-tab icon (index.html), the tray icon and the installer icon: a pink
 * fox face (black-tipped ears, white cheeks and snout, big sparkly eyes) on a midnight-blue tile. From 40px up a small
 * white bloom sits by its ear; smaller than that it would only be a speck.
 */
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#1d2440" />
      <path d="M12 4L28 18L14 26Z" fill="#f48fae" />
      <path d="M52 4L36 18L50 26Z" fill="#e2769a" />
      <path d="M12 4L17.4 8.8L13.2 11.6Z M52 4L46.6 8.8L50.8 11.6Z" fill="#3b1530" />
      <path d="M14.8 12.4L23.4 19.2L16 23.4Z M49.2 12.4L40.6 19.2L48 23.4Z" fill="#fff4f7" />
      <path d="M16 18C24 14 40 14 48 18L52 28L60 34L50 37L45 45L32 54L19 45L14 37L4 34L12 28Z" fill="#f48fae" />
      <path d="M26.6 16.8L32 22.6L37.4 16.8C34 16 30 16 26.6 16.8Z" fill="#e2769a" />
      <path d="M5 34L14 32.6C19 38.6 25 41.4 32 42.6C39 41.4 45 38.6 50 32.6L59 34L50 37.6L45 45L32 54L19 45L14 37.6Z" fill="#fff4f7" />
      <path d="M29.4 49.4C29.4 47.8 34.6 47.8 34.6 49.4C34.6 51 33 52.4 32 52.4C31 52.4 29.4 51 29.4 49.4Z" fill="#3b1530" />
      <ellipse cx="23.6" cy="30.6" rx="3.3" ry="3.8" fill="#3b1530" />
      <ellipse cx="40.4" cy="30.6" rx="3.3" ry="3.8" fill="#3b1530" />
      <circle cx="24.8" cy="29.2" r="1.25" fill="#ffffff" />
      <circle cx="41.6" cy="29.2" r="1.25" fill="#ffffff" />
      <circle cx="22.7" cy="32.2" r="0.55" fill="#ffffff" />
      <circle cx="39.5" cy="32.2" r="0.55" fill="#ffffff" />
      {size >= 40 && (
        <g>
          <g fill="#ffffff">
            <circle cx="20.6" cy="20.4" r="2.3" />
            <circle cx="23.8" cy="22" r="2.3" />
            <circle cx="23.2" cy="25.6" r="2.3" />
            <circle cx="19.4" cy="25.8" r="2.3" />
            <circle cx="18" cy="22.4" r="2.3" />
          </g>
          <circle cx="20.9" cy="23.3" r="1.5" fill="#f2c94c" />
        </g>
      )}
    </svg>
  );
}
