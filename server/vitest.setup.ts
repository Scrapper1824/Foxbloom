import { setHashCostForTests } from './src/auth/password.js';

// Passwords hashed in tests use scrypt N = 2^10 instead of the real 2^15: still real scrypt, ~1/32 of the work.
// auth.test.ts checks the real cost separately.
setHashCostForTests(1024);
