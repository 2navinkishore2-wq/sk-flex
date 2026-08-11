import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Smartphone, Monitor, Globe } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { APP_NAME, APP_TAGLINE } from '../lib/constants';
import { getLogoDataUrl } from '../lib/logo';
import { Button } from '../components/ui';

export function LoginPage() {
  const app = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'google' | 'demo' | null>(null);
  const [demoName, setDemoName] = useState('');
  const [showDemoForm, setShowDemoForm] = useState(false);
  const [error, setError] = useState('');
  const [logo, setLogo] = useState('');

  useEffect(() => {
    void getLogoDataUrl(152).then(setLogo);
  }, []);

  useEffect(() => {
    if (app.user) navigate('/', { replace: true });
  }, [app.user, navigate]);

  const doGoogle = async () => {
    setBusy('google');
    setError('');
    try {
      await app.signInGoogle();
      // onAuthChange will flip the user state and redirect
    } catch (e) {
      // TEMP-DIAG: surface the exact underlying error until the root cause is
      // identified (then revert to the friendly message).
      const msg = (e as Error).message;
      setError(msg.includes('cancelled') ? 'Sign-in was cancelled.' : `Google sign-in failed: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const doDemo = async () => {
    setBusy('demo');
    setError('');
    try {
      await app.signInDemo(demoName || 'Shop Owner');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const showSetup = app.mode === 'none';

  return (
    <div className="auth-page">
      <div className="auth-card">
        {logo ? <img className="auth-logo" src={logo} alt={APP_NAME} /> : null}
        <div className="auth-title">{APP_NAME}</div>
        <div className="auth-sub">{APP_TAGLINE}</div>

        {showSetup ? (
          <div>
            <div className="setup-steps">
              <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Cloud configuration required</div>
              <div style={{ marginBottom: 8 }}>
                This build has <code>VITE_DATA_MODE=cloud</code> but the Firebase values in <code>.env</code> are missing. To enable Google sign-in and cloud sync:
              </div>
              <ol style={{ margin: '0 0 0 18px', padding: 0 }}>
                <li>Create a free Firebase project (console.firebase.google.com)</li>
                <li>Add a <b>Web app</b> and copy its config</li>
                <li>Enable <b>Google</b> under Authentication → Sign-in method</li>
                <li>Put the values in <code>.env</code> (see <code>.env.example</code>)</li>
                <li>Deploy the rules in <code>firebase/firestore.rules</code></li>
              </ol>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" block onClick={() => setShowDemoForm(true)} disabled={busy !== null}>
                Continue in Demo Mode
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <button className="google-btn" onClick={() => void doGoogle()} disabled={busy !== null}>
              <GoogleIcon />
              {busy === 'google' ? 'Signing in…' : 'Sign in with Google'}
            </button>
            <div className="divider">or</div>
            {!showDemoForm ? (
              <Button variant="ghost" block onClick={() => setShowDemoForm(true)} disabled={busy !== null}>
                Continue without account (Demo)
              </Button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  placeholder="Your name (optional)"
                  value={demoName}
                  onChange={(e) => setDemoName(e.target.value)}
                  maxLength={40}
                  onKeyDown={(e) => e.key === 'Enter' && void doDemo()}
                />
                <Button onClick={() => void doDemo()} disabled={busy !== null}>
                  {busy === 'demo' ? 'Entering…' : 'Enter'}
                </Button>
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Globe size={13} /> Web</span>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Monitor size={13} /> Windows</span>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Smartphone size={13} /> Android</span>
            </div>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {app.mode === 'local' && app.configured === false && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Demo mode: everything stays on this device. Add Firebase config to enable Google sign-in and multi-device sync.
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
