import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFirebaseConfig } from './services/firestoreService';
import { createService } from './services/index';

const rulesPath = resolve(process.cwd(), 'firebase/firestore.rules');
const indexesPath = resolve(process.cwd(), 'firebase/firestore.indexes.json');

const FULL_ENV: Record<string, string> = {
  VITE_FIREBASE_API_KEY: 'AIzaSy-test-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'sk-flex-billing-test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'sk-flex-billing-test',
  VITE_FIREBASE_STORAGE_BUCKET: 'sk-flex-billing-test.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  VITE_FIREBASE_APP_ID: '1:123456789012:web:abcdef1234567890'
};

describe('Firestore security rules (firebase/firestore.rules)', () => {
  const rules = readFileSync(rulesPath, 'utf8');

  it('exists and references the uid-based isolation check', () => {
    expect(rules).toContain("request.auth.uid == userId");
    expect(rules).toContain("request.auth != null");
  });

  it('grants NO public or unauthenticated access (every allow requires a signed-in user)', () => {
    // Collect every `allow ... ;` / `allow ... : if ...` statement.
    const allowStatements = rules
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('allow '));
    expect(allowStatements.length).toBeGreaterThan(0);
    for (const stmt of allowStatements) {
      // A bare "allow read, write;" (no condition) is the dangerous form —
      // every statement here must carry an `: if` condition.
      expect(stmt).toMatch(/: if /);
      expect(stmt).not.toContain('if true');
      // Every rule must require authentication.
      expect(stmt).toContain('request.auth != null');
    }
  });

  it('scopes data to the authenticated user only (no cross-user or global paths)', () => {
    // Data lives under /users/{userId}/... and the uid must match the caller.
    expect(rules).toContain('match /users/{userId}/{document=**}');
    // The ONLY top-level paths matched are the standard `databases` container
    // and `users` — no other collections are exposed.
    const topLevels = [...rules.matchAll(/match \/([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
    expect(new Set(topLevels)).toEqual(new Set(['databases', 'users']));
    // The isolation expression is the ONLY condition used.
    expect(rules).toContain('if request.auth != null && request.auth.uid == userId');
  });
});

describe('Firestore indexes (firebase/firestore.indexes.json)', () => {
  const indexes = JSON.parse(readFileSync(indexesPath, 'utf8'));

  it('is a valid index manifest', () => {
    expect(Array.isArray(indexes.indexes)).toBe(true);
    expect(indexes.indexes.length).toBeGreaterThan(0);
    for (const idx of indexes.indexes) {
      expect(typeof idx.collectionGroup).toBe('string');
      expect(idx.queryScope).toBe('COLLECTION');
      expect(Array.isArray(idx.fields)).toBe(true);
      expect(idx.fields.length).toBeGreaterThanOrEqual(1); // explicit single-field entries are valid
      for (const f of idx.fields) {
        expect(typeof f.fieldPath).toBe('string');
        expect(['ASCENDING', 'DESCENDING']).toContain(f.order);
      }
    }
  });
});

describe('Firebase env config (readFirebaseConfig)', () => {
  it('requires all six values — returns null when any is missing or blank', () => {
    for (const key of Object.keys(FULL_ENV)) {
      const partial = { ...FULL_ENV, [key]: '' };
      expect(readFirebaseConfig(partial), `missing ${key}`).toBeNull();
    }
    expect(readFirebaseConfig({})).toBeNull();
    expect(readFirebaseConfig({ ...FULL_ENV, VITE_FIREBASE_PROJECT_ID: '   ' })).toBeNull();
  });

  it('parses a complete config and trims whitespace', () => {
    const cfg = readFirebaseConfig({
      ...FULL_ENV,
      VITE_FIREBASE_API_KEY: '  AIzaSy-test-key  '
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.apiKey).toBe('AIzaSy-test-key');
    expect(cfg!.projectId).toBe('sk-flex-billing-test');
  });
});

describe('Data-mode selection (createService)', () => {
  it('auto mode: falls back to local/demo when Firebase config is absent', () => {
    const bundle = createService({ VITE_DATA_MODE: 'auto' });
    expect(bundle.mode).toBe('local');
    expect(bundle.configured).toBe(false);
  });

  it('local mode: always local even with full Firebase config', () => {
    const bundle = createService({ VITE_DATA_MODE: 'local', ...FULL_ENV });
    expect(bundle.mode).toBe('local');
  });

  it('cloud mode without config: reports "none" (setup screen shown)', () => {
    const bundle = createService({ VITE_DATA_MODE: 'cloud' });
    expect(bundle.mode).toBe('none');
    expect(bundle.configured).toBe(false);
  });
});
