/* Print the SHA-1 / SHA-256 fingerprints of this project's Android signing
 * keystores — the values you register in the Firebase console under
 * Project settings -> Your apps -> (Android app) -> SHA certificate
 * fingerprints. Requires a JDK (keytool) on PATH or JAVA_HOME.
 *
 * Usage: node scripts/android-shas.mjs   (or: npm run android:shas)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

function findKeytool() {
  const candidates = ['keytool'];
  if (process.env.JAVA_HOME) {
    candidates.push(join(process.env.JAVA_HOME, 'bin', 'keytool'));
    candidates.push(join(process.env.JAVA_HOME, 'bin', 'keytool.exe'));
  }
  for (const c of candidates) {
    if (c !== 'keytool' && !existsSync(c)) continue;
    const r = spawnSync(c, ['-help'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return c;
  }
  return null;
}

function runKeytool(keytool, args) {
  const r = spawnSync(keytool, args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim();
    throw new Error(err || `keytool exited with code ${r.status}`);
  }
  return r.stdout;
}

function fingerprints(output) {
  const out = {};
  for (const m of output.matchAll(/SHA(1|256):\s*([0-9A-F:]+)/gi)) {
    out[m[1].toUpperCase()] = m[2];
  }
  return out;
}

function printKeystore(keytool, label, path, storepass, alias) {
  console.log(`\n=== ${label} ===`);
  console.log(`Keystore: ${path}`);
  if (!existsSync(path)) {
    console.log('NOT FOUND — skipping.');
    return;
  }
  try {
    const args = ['-list', '-v', '-keystore', path, '-storepass', storepass];
    if (alias) args.push('-alias', alias);
    const fp = fingerprints(runKeytool(keytool, args));
    if (fp['1']) console.log(`SHA-1:   ${fp['1']}`);
    if (fp['256']) console.log(`SHA-256: ${fp['256']}`);
    if (!fp['1'] && !fp['256']) console.log('No SHA fingerprints found in keytool output.');
    console.log('(Paste these into Firebase Console -> Project settings -> Your apps -> the Android app -> Add fingerprint.)');
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

const keytool = findKeytool();
if (!keytool) {
  console.error('keytool not found. Install a JDK (https://adoptium.net) or set JAVA_HOME.');
  process.exit(1);
}
console.log(`Using keytool from: ${keytool}\n`);

const debugPath = join(homedir(), '.android', 'debug.keystore');
printKeystore(keytool, 'DEBUG keystore', debugPath, 'android', 'androiddebugkey');

const propsPath = resolve('android', 'keystore.properties');
if (existsSync(propsPath)) {
  const props = Object.fromEntries(
    readFileSync(propsPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
  const storePath = resolve('android', props.storeFile || '');
  printKeystore(keytool, 'RELEASE keystore', storePath, props.storePassword || '', props.keyAlias || '');
} else {
  console.log('\n=== RELEASE keystore ===');
  console.log('android/keystore.properties not found — the release APK is currently UNSIGNED.');
  console.log('Create it from android/keystore.properties.example (see README §7) to sign releases.');
}
