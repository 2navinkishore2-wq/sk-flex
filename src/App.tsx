import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './store/AppContext';
import { ToastProvider, Spinner, useToast } from './components/ui';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { BillingPage } from './pages/Billing';
import { InvoicesPage } from './pages/Invoices';
import { InvoiceViewPage } from './pages/InvoiceView';
import { CustomersPage } from './pages/Customers';
import { CustomerDetailPage } from './pages/CustomerDetail';
import { LedgerPage } from './pages/Ledger';
import { RatesPage } from './pages/Rates';
import { InventoryPage } from './pages/Inventory';
import { SettingsPage } from './pages/Settings';
import { useUpdateWatcher } from './lib/useUpdateWatcher';

/**
 * Shows the "Clear Data (All)" success message after the data-layer reload:
 * the Settings page stashes a flag in sessionStorage before reloading, and
 * this component renders the toast on the next page (cloud data re-synced).
 */
function PostClearToast() {
  const toast = useToast();
  useEffect(() => {
    let msg: string | null = null;
    try {
      msg = sessionStorage.getItem('skfb:cleared:msg');
      if (msg) sessionStorage.removeItem('skfb:cleared:msg');
    } catch {
      /* sessionStorage unavailable — skip */
    }
    if (msg) toast(msg, 'success');
  }, [toast]);
  return null;
}

function Shell() {
  const { user, authLoading, ready } = useApp();
  // Startup + reconnect update checks (non-blocking, silent on failure).
  useUpdateWatcher();

  if (authLoading) {
    return (
      <div className="auth-page">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (!ready) {
    return (
      <div className="auth-page">
        <Spinner label="Opening your account…" />
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/billing/:invoiceId" element={<BillingPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/invoices/:id" element={<InvoiceViewPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/rates" element={<RatesPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <ToastProvider>
          <PostClearToast />
          <Shell />
        </ToastProvider>
      </AppProvider>
    </HashRouter>
  );
}
