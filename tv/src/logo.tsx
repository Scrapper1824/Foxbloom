/** The Foxbloom fox (same shapes as web/src/components/Logo.tsx, without the small bloom). */
export function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
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
    </svg>
  );
}
