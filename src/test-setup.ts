import { vi } from 'vitest';

/**
 * Tests must be deterministic regardless of whether a real `.env` exists on
 * the machine. This runs before any test module is collected, so the module
 * graph (App -> services/index.ts -> createService) sees a fixed environment:
 * local/demo mode with no Firebase config.
 *
 * Tests that intentionally exercise cloud behavior stub their own env and use
 * dynamic imports (see auth.flow.test.tsx) — vi.stubEnv in a test overrides
 * these baseline stubs for that test.
 */
vi.stubEnv('VITE_DATA_MODE', 'local');
vi.stubEnv('VITE_FIREBASE_API_KEY', '');
vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', '');
vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', '');
vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', '');
vi.stubEnv('VITE_FIREBASE_APP_ID', '');
vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', '');
vi.stubEnv('VITE_FIREBASE_EMULATOR_HOST', '');
