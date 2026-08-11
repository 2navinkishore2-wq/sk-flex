import { useRef, useState } from 'react';
import { Save, Download, Upload, FileSpreadsheet, ShieldCheck, Database, LogOut, Trash2 } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { BusinessSettings } from '../lib/types';
import { saveBusinessSettings } from '../services/settings';
import { customersToCSV, exportBackup, importBackup, invoicesToCSV, triggerTextDownload, type BackupFile } from '../services/backup';
import { clearAllLocalData } from '../lib/clearData';
import { APP_NAME } from '../lib/constants';
import { Button, Card, ConfirmDialog, Field, Row, useToast } from '../components/ui';

export function SettingsPage() {
  const app = useApp();
  const toast = useToast();
  const [form, setForm] = useState<BusinessSettings>(app.business);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    setSaving(true);
    try {
      await saveBusinessSettings(app.service, form);
      toast('Invoice settings saved', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const doBackup = async () => {
    setBackingUp(true);
    try {
      const file = await exportBackup(app.service);
      const stamp = new Date().toISOString().slice(0, 10);
      triggerTextDownload(JSON.stringify(file, null, 2), `sk-flex-billing-backup-${stamp}.json`);
      toast('Backup exported', 'success');
    } catch (e) {
      toast('Backup failed: ' + (e as Error).message, 'error');
    } finally {
      setBackingUp(false);
    }
  };

  const doClearAll = async () => {
    setClearing(true);
    try {
      await clearAllLocalData(app.service);
      try {
        // Survives the reload below so a clear success message is shown after
        // the data layer restarts with the now-empty account.
        sessionStorage.setItem('skfb:cleared:msg', 'All account data cleared.');
      } catch {
        /* sessionStorage unavailable — toast before reload is enough */
      }
      toast('Account data cleared', 'success');
      // Give the toast a moment to render, then restart the data layer so the
      // UI shows the freshly emptied account (empty lists, Outstanding ₹0).
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      toast('Clear failed: ' + (e as Error).message, 'error');
      setClearing(false);
    }
  };

  const onRestoreFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as BackupFile;
      const summary = await importBackup(app.service, parsed);
      toast(`Restored ${summary.documents} records from ${summary.collections} collections`, 'success');
      setRestoreOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Business details shown on invoices, backup and sync</p>

      <Card title="Invoice / Business details" right={<ShieldCheck size={18} color="var(--text-3)" />}>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>
          These appear on every new invoice. The application name <b>SK Flex Billing</b> and logo are fixed.
        </div>
        <div className="grid grid-2">
          <Field label="Business address">
            <textarea className="textarea" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Shop address shown on the invoice" />
          </Field>
          <div>
            <Field label="Phone number">
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Shop phone" />
            </Field>
            <Field label="Email ID">
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Shop email" />
            </Field>
          </div>
        </div>
        <div className="grid grid-2">
          <Field label="GST number (optional)">
            <input className="input" value={form.gst} onChange={(e) => setForm({ ...form, gst: e.target.value })} placeholder="e.g. 33ABCDE1234F1Z5" />
          </Field>
          <Field label="Invoice number prefix">
            <input className="input" value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })} maxLength={6} placeholder="SK" />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Next numbers look like {form.invoicePrefix || 'SK'}-0001, {form.invoicePrefix || 'SK'}-0002…</div>
          </Field>
        </div>
        <Field label="Invoice footer / thank-you note">
          <input className="input" value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} placeholder="Thank you for your business!" />
        </Field>
        <Field label="Payment note">
          <input className="input" value={form.paymentNote} onChange={(e) => setForm({ ...form, paymentNote: e.target.value })} placeholder="e.g. Balance payment is expected within 30 days." />
        </Field>
        <Button onClick={() => void save()} disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save Settings'}</Button>
      </Card>

      <Card title="Backup & Export" right={<Database size={18} color="var(--text-3)" />}>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>
          The cloud database is your primary backup (all devices stay in sync). These exports give you an extra local copy.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="dark" onClick={() => void doBackup()} disabled={backingUp}>
            <Download size={16} /> {backingUp ? 'Exporting…' : 'Export Backup (JSON)'}
          </Button>
          <Button variant="ghost" onClick={() => setRestoreOpen(true)}>
            <Upload size={16} /> Restore Backup
          </Button>
          <Button variant="ghost" onClick={() => triggerTextDownload(invoicesToCSV(app.invoices), 'invoices.csv', 'text/csv')}>
            <FileSpreadsheet size={16} /> Invoices CSV
          </Button>
          <Button variant="ghost" onClick={() => triggerTextDownload(customersToCSV(app.customers), 'customers.csv', 'text/csv')}>
            <FileSpreadsheet size={16} /> Customers CSV
          </Button>
        </div>
      </Card>

      <Card title="Account & App">
        <Row>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700 }}>{app.user?.name}</div>
            <div style={{ color: 'var(--text-2)', fontSize: 13 }}>
              {app.user?.email || 'Demo account'} · {app.mode === 'cloud' ? 'Cloud sync enabled' : 'Demo mode — data on this device'}
            </div>
          </div>
          <Button variant="ghost" onClick={() => void app.signOut()}>
            <LogOut size={16} /> Sign out
          </Button>
        </Row>
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--text-3)' }}>
          {APP_NAME} v1.0.0 · One account works on Web, Windows and Android.
        </div>
        <Row style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <Button variant="danger" onClick={() => setClearOpen(true)} disabled={clearing}>
            <Trash2 size={16} /> {clearing ? 'Clearing…' : 'Clear Data (All)'}
          </Button>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', maxWidth: 340 }}>
            Permanently deletes this account's customers, invoices, payments, ledger history and rates from the cloud database and this device's cache. Your sign-in stays active.
          </div>
        </Row>
      </Card>

      <ConfirmDialog
        open={clearOpen}
        title="Clear Data (All)?"
        danger
        confirmLabel="Clear everything"
        message={
          <div>
            This <b>permanently deletes ALL of this account's business data</b> — customers,
            invoices, payments, ledger/history and rates — from the <b>cloud database</b> and this
            device's cache. It cannot be undone. Your sign-in and Firebase account stay active.
            Continue?
          </div>
        }
        onConfirm={() => {
          setClearOpen(false);
          void doClearAll();
        }}
        onCancel={() => setClearOpen(false)}
      />
      <ConfirmDialog
        open={restoreOpen}
        title="Restore backup?"
        danger={false}
        confirmLabel="Choose file"
        message="Restoring merges the backup records into this account, overwriting documents with the same ID. Continue?"
        onConfirm={() => fileRef.current?.click()}
        onCancel={() => setRestoreOpen(false)}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onRestoreFile(e.target.files?.[0]);
          setRestoreOpen(false);
        }}
      />
    </div>
  );
}
