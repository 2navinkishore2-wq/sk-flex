import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ReceiptText,
  FileText,
  Users,
  BookOpen,
  SlidersHorizontal,
  Warehouse,
  Settings,
  Menu as MenuIcon,
  X,
  LogOut,
  WifiOff,
  Eye
} from 'lucide-react';
import { useApp } from '../store/AppContext';
import { SyncPill } from './ui';
import { getLogoDataUrl } from '../lib/logo';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/billing', label: 'Billing', icon: ReceiptText, end: true },
  { to: '/invoices', label: 'Invoices', icon: FileText, end: true },
  { to: '/customers', label: 'Customers', icon: Users, end: true },
  { to: '/ledger', label: 'Ledger', icon: BookOpen, end: true },
  { to: '/rates', label: 'Rates', icon: SlidersHorizontal, end: true },
  { to: '/inventory', label: 'Inventory', icon: Warehouse, end: true },
  { to: '/settings', label: 'Settings', icon: Settings, end: true }
];

const MORE_ITEMS = NAV.slice(4);

/**
 * Account avatar: shows the Google profile photo when available, falls back
 * to initials if the photo is missing OR fails to load (never a broken image).
 */
function UserAvatar({ photoURL, name, size }: { photoURL?: string | null; name?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  // Reset the failure flag when the signed-in user changes.
  useEffect(() => setFailed(false), [photoURL]);
  const style = size ? { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) } : undefined;
  if (photoURL && !failed) {
    return (
      <div className="avatar" style={style}>
        <img src={photoURL} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </div>
    );
  }
  return <div className="avatar" style={style}>{(name || 'U').slice(0, 2).toUpperCase()}</div>;
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, syncStatus, syncError, demo, online, signOut, preview } = useAppCompat();
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();
  const [logo, setLogo] = useState<string>('');

  useEffect(() => {
    void getLogoDataUrl(96).then(setLogo);
  }, []);

  const renderNav = (items: typeof NAV, mobile = false) =>
    items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        style={mobile ? { display: 'flex' } : undefined}
      >
        <item.icon size={19} />
        <span>{item.label}</span>
      </NavLink>
    ));

  return (
    <div className="app-shell">
      {/* desktop sidebar */}
      <aside className="sidebar">
        <div className="brand">
          {logo ? <img src={logo} alt="SK Flex Billing" /> : <div className="avatar" style={{ borderRadius: 11, width: 40, height: 40 }}>SK</div>}
          <div>
            <div className="brand-name">SK Flex Billing</div>
            <div className="brand-sub">Flex & Sign Shop</div>
          </div>
        </div>
        <nav className="nav">{renderNav(NAV)}</nav>
        <div className="sidebar-foot">
          <SyncPill status={syncStatus} demo={demo} errorMsg={syncError} />
          <div style={{ height: 10 }} />
          <div className="user-chip">
            <UserAvatar photoURL={user?.photoURL} name={user?.name} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-name">{user?.name}</div>
              <div className="user-mail">{demo ? 'Demo mode' : user?.email || ''}</div>
            </div>
            <button className="icon-btn" style={{ background: 'transparent', borderColor: 'rgba(148,163,184,0.25)', color: 'var(--nav-muted)' }} onClick={() => void signOut()} title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* mobile top bar */}
      <div className="topbar">
        <div className="brand">
          {logo ? <img src={logo} alt="" /> : <div className="avatar">SK</div>}
          <div>
            <div className="brand-name" style={{ fontSize: 14.5 }}>SK Flex Billing</div>
            <div className="brand-sub">Flex & Sign Shop</div>
          </div>
        </div>
        <div className="topbar-right">
          <UserAvatar photoURL={user?.photoURL} name={user?.name} size={30} />
          {user?.name && <span className="topbar-user-name">{user?.name}</span>}
          <SyncPill status={syncStatus} demo={demo} errorMsg={syncError} />
        </div>
      </div>

      <main className="main-area">
        {preview && (
          <div className="preview-banner">
            <Eye size={15} />
            Preview SK Flex — read-only sample data. Nothing is saved; sign in with Google to use your own account.
          </div>
        )}
        {!online && !demo && (
          <div className="offline-banner">
            <WifiOff size={15} />
            You're offline — bills still work and will sync automatically when you're back online.
          </div>
        )}
        {children}
      </main>

      {/* mobile bottom nav */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {NAV.slice(0, 4).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `bn-item${isActive ? ' active' : ''}`}>
              <item.icon size={22} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button className="bn-item" onClick={() => setMoreOpen(true)}>
            <MenuIcon size={22} />
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* More sheet */}
      {moreOpen && (
        <div className="modal-backdrop" style={{ alignItems: 'flex-end', padding: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
          <div className="modal" style={{ maxWidth: 560, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
            <div className="modal-head">
              <h3>More</h3>
              <button className="icon-btn" onClick={() => setMoreOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                {MORE_ITEMS.map((item) => (
                  <button
                    key={item.to}
                    className="btn btn-ghost"
                    style={{ justifyContent: 'flex-start', padding: '13px 14px' }}
                    onClick={() => {
                      setMoreOpen(false);
                      navigate(item.to);
                    }}
                  >
                    <item.icon size={19} />
                    {item.label}
                  </button>
                ))}
                <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: '13px 14px', color: 'var(--red)' }} onClick={() => void signOut()}>
                  <LogOut size={19} />
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function useAppCompat() {
  const app = useApp();
  return {
    user: app.user,
    syncStatus: app.syncStatus,
    syncError: app.syncError,
    demo: app.mode === 'local',
    online: app.online,
    signOut: app.signOut,
    preview: app.preview
  };
}
