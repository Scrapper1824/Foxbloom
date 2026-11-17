import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Many tests sign accounts in, and password hashing is deliberately slow (scrypt). On a busy machine (the
    // release script installs and builds right before testing) that can pass the default 5 s, failing a test
    // that's actually fine.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
