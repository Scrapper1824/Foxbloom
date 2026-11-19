import { Logo } from './logo';

/** Placeholder root screen until sign-in and the library arrive in later tasks. */
export function Home() {
  return (
    <div class="home">
      <Logo size={160} />
      <h1>Foxbloom</h1>
      <button data-focusable class="btn">
        Get started
      </button>
    </div>
  );
}
