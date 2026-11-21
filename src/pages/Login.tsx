import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Smartphone, Monitor, Globe, RefreshCw, AlertTriangle } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { APP_NAME, APP_TAGLINE } from '../lib/constants';
import { getLogoDataUrl } from '../lib/logo';
import { missingFirebaseEnv } from '../services/index';
import { runtimePlatform } from '../lib/platform';
import { Button } from '../components/ui';

export function LoginPage() {
  const app = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'google' | 'preview' | null>(null);
  const [error, setError] = useState('');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [logo, setLogo] = useState('');

  useEffect(() => {
    void getLogoDataUrl(152).then(setLogo);
  }, []);

  useEffect(() => {
    if (app.user) navigate('/', { replace: true });
  }, [app.user, navigate]);

  // A build compiled without Firebase config has no cloud backend at all, so a
  // Google button could only ever fail. Never offer it in that state.
  const googleAvailable = app.configured;
  const missing = googleAvailable ? [] : missingFirebaseEnv();

  const runGoogle = async () => {
    setBusy('google');
    setError('');
    try {
      await app.signInGoogle();
      // onAuthChange will flip the user state and redirect
    } catch (e) {
      const msg = (e as Error).message || 'Google sign-in failed.';
      setError(/cancelled/i.test(msg) ? 'Sign-in was cancelled.' : msg);
    } finally {
      setBusy(null);
    }
  };

  /** Read-only sample workspace — no guest account and no stored data. */
  const doPreview = async () => {
    setBusy('preview');
    setError('');
    try {
      await app.signInPreview();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        {logo ? <img className="auth-logo" src={logo} alt={APP_NAME} /> : null}
        <div className="auth-title">{APP_NAME}</div>
        <div className="auth-sub">{APP_TAGLINE}</div>

        {googleAvailable ? (
          <div>
            <button className="google-btn" onClick={() => void runGoogle()} disabled={busy !== null}>
              <GoogleIcon />
              {busy === 'google' ? 'Signing in…' : 'Sign in with Google'}
            </button>
            <div className="divider">or</div>
            <Button variant="ghost" block onClick={() => void doPreview()} disabled={busy !== null}>
              {busy === 'preview' ? 'Opening preview…' : 'Preview SK Flex'}
            </Button>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
              Read-only sample bills, customers and stock. Nothing is saved and no account is created.
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Globe size={13} /> Web</span>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Monitor size={13} /> Windows</span>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Smartphone size={13} /> Android</span>
            </div>
          </div>
        ) : (
          <div>
            <div className="setup-steps">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                <AlertTriangle size={15} /> Google sign-in is not configured in this build
              </div>
              <div style={{ marginBottom: 8 }}>
                This build has no Firebase configuration, so there is no cloud account to sign in to. Add these values to
                <code> .env</code> (see <code>.env.example</code>) and rebuild:
              </div>
              <ul style={{ margin: '0 0 10px 18px', padding: 0 }}>
                {missing.map((key) => (
                  <li key={key} style={{ marginBottom: 2 }}>
                    <code>{key}</code>
                  </li>
                ))}
              </ul>
              <ol style={{ margin: '0 0 0 18px', padding: 0 }}>
                <li>Open your existing Firebase project (Project settings → Your apps → Web app).</li>
                <li>Copy the six config values into <code>.env</code>.</li>
                <li>Authentication → Sign-in method: enable <b>Google</b>.</li>
                <li>Add the Windows OAuth <b>Desktop</b> client ID as <code>VITE_GOOGLE_DESKTOP_CLIENT_ID</code>.</li>
                <li>Rebuild the app (<code>npm run build</code> / <code>npm run electron:build</code>).</li>
              </ol>
            </div>
            <Button variant="ghost" block onClick={() => void doPreview()} disabled={busy !== null}>
              {busy === 'preview' ? 'Opening preview…' : 'Preview SK Flex'}
            </Button>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
              Preview is read-only and works fully offline.
            </div>
          </div>
        )}

        {error && (
          <div className="form-error" role="alert">
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <AlertTriangle size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
              <span>{error}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={() => void runGoogle()} disabled={busy !== null}>
                <RefreshCw size={13} style={{ marginRight: 4, verticalAlign: -2 }} /> Retry
              </Button>
              <button
                type="button"
                onClick={() => setShowDiagnostics((v) => !v)}
                style={{ background: 'none', border: 0, padding: 0, fontSize: 11.5, color: 'var(--text-3)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                {showDiagnostics ? 'Hide diagnostics' : 'Diagnostics'}
              </button>
            </div>
            {showDiagnostics && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>
                {[
                  `platform: ${runtimePlatform()}`,
                  `data mode: ${app.mode}`,
                  `cloud configured: ${app.configured ? 'yes' : 'no'}`,
                  `online: ${app.online ? 'yes' : 'no'}`,
                  missing.length ? `missing: ${missing.join(', ')}` : 'missing: —'
                ].join('\n')}
              </div>
            )}
          </div>
        )}

        {googleAvailable && app.mode === 'local' && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            You are in the offline preview workspace. Sign in with Google to use your cloud account.
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/>
    </svg>
  );
}
