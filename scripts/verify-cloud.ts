/**
 * SK Flex Billing — cloud verification script.
 *
 * Drives the APP'S REAL services (FirestoreDataService + createCustomer /
 * createInvoice / recordPayment / ledger / reconcile) against the Firebase
 * emulator with the real security rules from firebase/firestore.rules.
 *
 * Reports 8 checks:
 *   [1/8] authentication                    — Google-style sign-in establishes a session + basePath
 *   [2/8] user isolation                    — user B cannot read/write user A's data (rules enforced)
 *   [3/8] two-device sync                   — a write on device A appears live on device B (realtime listener)
 *   [4/8] offline invoice creation          — a bill created with the network off is retained locally
 *   [5/8] reconnect/resume sync             — queued data reaches the server after reconnect, exactly once
 *   [6/8] duplicate prevention              — racing/offline number collisions are repaired (reconcile)
 *   [7/8] invoice number allocation         — sequential, unique, correctly formatted numbers
 *   [8/8] persistence after sign-out/in     — data survives a fresh session on another client
 *
 * Requirements: Java 11+ (JDK 17 recommended) on PATH. One-time emulator
 * downloads happen automatically on first run.
 *
 * Run:  npm run cloud:verify
 *       (starts the emulators, runs this script, then shuts them down)
 */
// Polyfill IndexedDB so the persistent (offline) cache behaves exactly like
// the browser — must run before any firebase import.
import 'fake-indexeddb/auto';

import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, disableNetwork, enableNetwork } from 'firebase/firestore';
import { FirestoreDataService } from '../src/services/firestoreService';
import { createCustomer } from '../src/services/customers';
import { createInvoice } from '../src/services/invoices';
import type { Invoice, InvoiceDraft } from '../src/lib/types';

const EMU = { host: '127.0.0.1', firestorePort: 8080, authPort: 9099 };
const CFG = {
  apiKey: 'emulator-key',
  authDomain: 'demo-skflex.firebaseapp.com',
  projectId: 'demo-skflex',
  storageBucket: 'demo-skflex.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:000000000000'
};

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label: string, fn: () => boolean | Promise<boolean>, timeoutMs = 25000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fn()) return true;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  console.error(`  ⏱  timed out waiting for: ${label}`);
  return false;
}

/** One "device": its own Firebase app + auth + the app's real data service. */
function makeDevice(name: string) {
  const app = initializeApp(CFG, name);
  const svc = new FirestoreDataService(CFG, {
    appName: name,
    emulator: {
      authHost: EMU.host,
      authPort: EMU.authPort,
      firestoreHost: EMU.host,
      firestorePort: EMU.firestorePort
    }
  });
  // Same instances the service uses internally — getFirestore/getAuth return
  // the already-initialized (and already emulator-connected) instances for
  // this app. Do NOT call connect*Emulator again here: the service did it.
  const auth = getAuth(app);
  const db = getFirestore(app);
  return { app, svc, auth, db };
}

async function signInAs(dev: ReturnType<typeof makeDevice>, email: string, password: string) {
  try {
    await createUserWithEmailAndPassword(dev.auth, email, password);
  } catch {
    // User already exists in the emulator — sign in instead.
    await signInWithEmailAndPassword(dev.auth, email, password);
  }
  const ok = await waitFor(`sign-in as ${email}`, () => dev.svc.getAuthUser()?.email === email);
  return ok;
}

/** Live collection mirror via the service's realtime watch(). */
function mirror<T extends { id: string }>(svc: FirestoreDataService, name: string) {
  const list: T[] = [];
  const unsub = svc.watch<T>(name, undefined, (items) => {
    list.length = 0;
    list.push(...items);
  });
  return { list, unsub };
}

function draft(customerId: string, customer: InvoiceDraft['customer'], items: InvoiceDraft['items'], paid: number): InvoiceDraft {
  return {
    customerId,
    customer,
    items,
    discountType: 'amount',
    discountValue: 0,
    paid,
    date: new Date().toISOString().slice(0, 10)
  };
}

async function main() {
  console.log('SK Flex Billing — cloud verification (Firebase emulator, real rules)\n');

  // ---- devices ---------------------------------------------------------
  const devA = makeDevice('deviceA');
  const devB = makeDevice('deviceB');

  // ---- [1/8] authentication --------------------------------------------
  console.log('[1/8] authentication');
  const authA = await signInAs(devA, 'alice@test.dev', 'password123');
  const userA = devA.svc.getAuthUser();
  const uidA = userA?.uid ?? '';
  check('sign-in establishes a session (user + uid)', authA && !!uidA);
  check('service basePath is scoped to the user', devA.svc.basePath === `users/${uidA}`, devA.svc.basePath);
  const authB = await signInAs(devB, 'bob@test.dev', 'password123');
  const uidB = devB.svc.getAuthUser()?.uid ?? '';
  check('second account signs in independently', authB && !!uidB);

  // ---- [2/8] user isolation --------------------------------------------
  console.log('\n[2/8] user isolation');
  // Alice writes her own data.
  const aliceCustomer = await createCustomer(devA.svc, { name: 'Ramesh', phone: '9876543210', address: '', email: '' });
  check('Alice can write to her own path', aliceCustomer.id.length > 0);
  // Bob (raw SDK on Bob's connection) must be denied on Alice's path.
  let deniedRead = false;
  let deniedWrite = false;
  try {
    await setDoc(doc(devB.db, `users/${uidA}/customers/evil`), { name: 'sneaky' });
  } catch (e) {
    deniedWrite = (e as { code?: string }).code === 'permission-denied';
  }
  check('Bob CANNOT write to Alice\'s path', deniedWrite);
  try {
    await getDoc(doc(devB.db, `users/${uidA}/customers/${aliceCustomer.id}`));
  } catch (e) {
    deniedRead = (e as { code?: string }).code === 'permission-denied';
  }
  check('Bob CANNOT read Alice\'s path', deniedRead);
  // Bob CAN use his own collection.
  const bobCustomer = await createCustomer(devB.svc, { name: 'Bob', phone: '9000000000', address: '', email: '' });
  const bobReadsOwn = (await devB.svc.get('customers', bobCustomer.id)) !== null;
  check('Bob can read his own data', bobReadsOwn);

  // ---- [3/8] two-device realtime sync ----------------------------------
  console.log('\n[3/8] two-device sync');
  // Device B signs in as Alice too (same account on two devices).
  await signOut(devB.auth);
  await signInAs(devB, 'alice@test.dev', 'password123');
  const customersB = mirror<{ id: string; name: string }>(devB.svc, 'customers');
  const invoicesB = mirror<Invoice>(devB.svc, 'invoices');
  await waitFor('device B initial customers load', () => customersB.list.length >= 1);

  const c2 = await createCustomer(devA.svc, { name: 'Suresh', phone: '9876500000', address: '', email: '' });
  const syncCust = await waitFor('customer created on A appears live on B', () =>
    customersB.list.some((c) => c.id === c2.id && c.name === 'Suresh')
  );
  check('customer created on device A appears on device B (realtime)', syncCust);

  // ---- [4/8] offline invoice creation ----------------------------------
  console.log('\n[4/8] offline invoice creation');
  // Mirror the real app: it watches every collection on load, so its local
  // cache is warm when the network drops. Warm the EXACT query targets the
  // offline path uses (they must match the app's cached watches): settings
  // unfiltered, invoices ordered by createdAt desc, ledger unfiltered.
  await devA.svc.query('settings');
  await devA.svc.query('invoices', { orderBy: { field: 'createdAt', dir: 'desc' } });
  await devA.svc.query('ledger');
  await disableNetwork(devA.db);
  const flexItem = { key: 'k1', product: 'FLEX' as const, label: 'Flex', width: 10, height: 10, area: 100, unit: 'sq.ft', qty: 1, rate: 7.5, amount: 750 };
  const offlineInvoice = await createInvoice(
    devA.svc,
    draft(aliceCustomer.id, { name: 'Ramesh', phone: '9876543210', address: '' }, [flexItem], 500)
  );
  const offlineLocal = (await devA.svc.get<Invoice>('invoices', offlineInvoice.id)) !== null;
  check('bill created while offline is saved locally (10x10 Flex = ₹750, ₹500 paid)', offlineLocal && offlineInvoice.total === 750);
  check('ledger queued offline: balance 750 - 500 = ₹250', offlineInvoice.balance === 250);

  // ---- [5/8] reconnect / resume sync -----------------------------------
  console.log('\n[5/8] reconnect / resume sync');
  await enableNetwork(devA.db);
  const resumed = await waitFor('offline bill reaches the server (visible on B)', () =>
    invoicesB.list.some((i) => i.id === offlineInvoice.id)
  );
  check('offline bill synchronizes to Firestore after reconnect', resumed);
  const allInvoices = await devB.svc.query<Invoice>('invoices');
  const sameNumber = allInvoices.filter((i) => i.number === offlineInvoice.number);
  check('no duplicate invoice created during reconnection', sameNumber.length === 1, `found ${sameNumber.length}`);
  // Mirrors the app: after the offline device reloads, the startup
  // reconciliation pass advances the counter past offline-minted numbers.
  const atResume = await devA.svc.query<Invoice>('invoices');
  await devA.svc.reconcileInvoiceNumbers!('SK', atResume.map((i) => ({ id: i.id, number: i.number, createdAt: i.createdAt })));
  const ledgerCount = (await devB.svc.query<{ id: string; customerId: string }>('ledger', {
    where: [{ field: 'customerId', op: '==', value: aliceCustomer.id }]
  })).length;
  check('ledger entries synced exactly once (invoice + payment = 2)', ledgerCount === 2, `found ${ledgerCount}`);
  const paymentCount = (await devB.svc.query<{ id: string; customerId: string }>('payments', {
    where: [{ field: 'customerId', op: '==', value: aliceCustomer.id }]
  })).length;
  check('payment recorded with the offline bill synced exactly once', paymentCount === 1, `found ${paymentCount}`);

  // ---- [6/8] duplicate prevention ---------------------------------------
  console.log('\n[6/8] duplicate prevention');
  // Two devices online create bills concurrently — the atomic counter must
  // hand out distinct numbers.
  const invA = await createInvoice(devA.svc, draft(aliceCustomer.id, { name: 'Ramesh', phone: '9876543210', address: '' }, [flexItem], 0));
  const invB = await createInvoice(devB.svc, draft(aliceCustomer.id, { name: 'Ramesh', phone: '9876543210', address: '' }, [flexItem], 0));
  check('two devices billed online get different numbers', invA.number !== invB.number, `${invA.number} vs ${invB.number}`);
  // Simulate the offline collision the atomic counter cannot prevent: two
  // devices mint the same number offline; reconciliation must repair it.
  const dupNumber = offlineInvoice.number;
  await setDoc(doc(devB.db, `users/${uidA}/invoices/dup-collision`), {
    number: dupNumber,
    createdAt: new Date(Date.now() + 60_000).toISOString(), // newer than the original
    total: 99
  });
  const all = await devB.svc.query<Invoice>('invoices');
  const fixed = await devB.svc.reconcileInvoiceNumbers!('SK', all.map((i) => ({ id: i.id, number: i.number, createdAt: i.createdAt })));
  check('reconcile renumbers the newer duplicate', fixed >= 1, `fixed ${fixed}`);
  const afterReconcile = await devB.svc.query<Invoice>('invoices');
  const numbers = afterReconcile.map((i) => i.number);
  check('all invoice numbers unique after reconciliation', new Set(numbers).size === numbers.length);
  const renumbered = afterReconcile.find((i) => i.id === 'dup-collision');
  check('repaired invoice is flagged (renumbered: true)', !!renumbered?.renumbered);

  // ---- [7/8] invoice number allocation ----------------------------------
  console.log('\n[7/8] invoice number allocation');
  const invNext = await createInvoice(devA.svc, draft(aliceCustomer.id, { name: 'Ramesh', phone: '9876543210', address: '' }, [flexItem], 0));
  const maxBefore = Math.max(...numbers.map((n) => Number(n.replace('SK-', ''))));
  const nextNum = Number(invNext.number.replace('SK-', ''));
  check('next online bill gets a number higher than every existing bill', nextNum > maxBefore, `${invNext.number} after max ${maxBefore}`);
  check('invoice number format is SK-####', /^SK-\d{4}$/.test(invNext.number), invNext.number);

  // ---- [8/8] persistence after sign-out / sign-in -----------------------
  console.log('\n[8/8] persistence after sign-out / sign-in');
  await signOut(devB.auth);
  await waitFor('device B signed out', () => devB.svc.getAuthUser() === null);
  await signInAs(devB, 'alice@test.dev', 'password123');
  const freshCustomers = await devB.svc.query<{ id: string; name: string }>('customers');
  const freshInvoices = await devB.svc.query<Invoice>('invoices');
  const names = freshCustomers.map((c) => c.name);
  check('customers persist after a fresh sign-in', names.includes('Ramesh') && names.includes('Suresh'), names.join(', '));
  check('invoices (incl. the offline one) persist after a fresh sign-in', freshInvoices.some((i) => i.id === offlineInvoice.id) && freshInvoices.length >= 4, `${freshInvoices.length} invoices`);
  // Audit: print every invoice (number, id, renumbered) so number allocation
  // and any accidental double-creation are visible in the report.
  console.log('  audit: invoices =', freshInvoices.map((i) => `${i.number}${i.renumbered ? '*' : ''} (${i.id.slice(0, 8)})`).join(', '));

  // ---- summary ----------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length === 0
      ? '\n🎉 ALL CLOUD CHECKS PASSED'
      : `\n⚠️  ${failed.length} CHECK(S) FAILED`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nScript error:', e?.message ?? e);
  if (e?.stack) console.error(e.stack);
  console.error('Is the emulator running? Use: npm run cloud:verify (starts it automatically). Requires Java 11+ (JDK 17 recommended).');
  process.exit(2);
});
