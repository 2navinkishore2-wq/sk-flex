import { useEffect, useState } from 'react';
import { RefreshCw, DownloadCloud, Info, CheckCircle2, WifiOff, AlertTriangle, ExternalLink } from 'lucide-react';
import { Button, Card, useToast } from './ui';
import {
  GITHUB_RELEASES_URL,
  checkForUpdate,
  currentAppVersion,
  downloadAndroidUpdate,
  downloadDesktopUpdate,
  installDesktopUpdate,
  updateStateLabel,
  type UpdateStatus
} from '../lib/updater';
import { runtimePlatform } from '../lib/platform';

const PLATFORM_LABEL: Record<string, string> = {
  electron: 'Windows',
  android: 'Android',
  web: 'Web',
  ios: 'iOS'
};

/** Settings → About: installed version, update check, release notes. */
export function AboutCard() {
  const toast = useToast();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const platform = runtimePlatform();
  const installed = currentAppVersion();

  useEffect(() => {
    const off = window.skFlexBilling?.update?.onProgress?.((p) => {
      setProgress(Math.round(p.percent || 0));
      if (p.state === 'downloaded') setStatus((s) => ({ ...s, state: 'available' }));
    });
    return () => off?.();
  }, []);

  const check = async () => {
    setBusy(true);
    setProgress(0);
    setStatus({ state: 'checking' });
    try {
      setStatus(await checkForUpdate({ currentVersion: installed, platform }));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (platform === 'android') {
      setBusy(true);
      const res = await downloadAndroidUpdate(status);
      setBusy(false);
      if (!res.ok) toast(res.error || 'Could not start the APK download', 'error');
      else toast('Download started — confirm the install when Android asks.', 'success');
      return;
    }
    setBusy(true);
    setProgress(0);
    const res = await downloadDesktopUpdate();
    setBusy(false);
    if (res.ok) {
      setStatus((s) => ({ ...s, state: 'downloading' }));
      toast('Update downloaded — use Restart & Update to install.', 'success');
    } else {
      toast(res.error || 'Download failed', 'error');
    }
  };

  const install = async () => {
    setBusy(true);
    const res = await installDesktopUpdate();
    setBusy(false);
    if (!res.ok) toast(res.error || 'Could not restart to update', 'error');
  };

  const icon =
    status.state === 'available' ? (
      <DownloadCloud size={18} color="var(--brand-600)" />
    ) : status.state === 'current' ? (
      <CheckCircle2 size={18} color="var(--green)" />
    ) : status.state === 'offline' ? (
      <WifiOff size={18} color="var(--amber)" />
    ) : status.state === 'error' ? (
      <AlertTriangle size={18} color="var(--red)" />
    ) : (
      <Info size={18} color="var(--text-3)" />
    );

  return (
    <Card title="About" right={<Info size={18} color="var(--text-3)" />}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700 }}>SK Flex Billing</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            Installed version <b>v{installed}</b> · {PLATFORM_LABEL[platform] || platform}
          </div>
        </div>
        <Button variant="ghost" onClick={() => void check()} disabled={busy || status.state === 'checking'}>
          <RefreshCw size={16} /> {status.state === 'checking' ? 'Checking…' : 'Check for updates'}
        </Button>
      </div>

      <div className="update-box">
        <div className="update-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {icon}
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {status.state === 'available'
                  ? `Update available — v${status.latestVersion}`
                  : updateStateLabel(status.state)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {status.state === 'available'
                  ? 'Download and install without losing your data.'
                  : status.state === 'current'
                    ? 'This is the latest compatible release.'
                    : status.state === 'offline'
                      ? 'You are offline — updates are checked again when the connection returns.'
                      : status.state === 'error'
                        ? status.error || 'The check failed. Try again in a moment.'
                        : 'Checks run automatically at startup and when the internet reconnects.'}
              </div>
            </div>
          </div>

          {status.state === 'available' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button onClick={() => void download()} disabled={busy}>
                <DownloadCloud size={16} /> {platform === 'android' ? 'Download APK' : 'Download update'}
              </Button>
              {platform === 'electron' && (
                <Button variant="dark" onClick={() => void install()} disabled={busy}>
                  Restart &amp; Update
                </Button>
              )}
              <Button variant="ghost" onClick={() => window.open(status.releaseUrl || GITHUB_RELEASES_URL, '_blank')}>
                <ExternalLink size={15} /> Release notes
              </Button>
            </div>
          )}
          {platform === 'web' && status.state === 'available' && (
            <Button variant="ghost" onClick={() => window.open(GITHUB_RELEASES_URL, '_blank')}>
              <ExternalLink size={15} /> Open releases
            </Button>
          )}
        </div>

        {(busy || progress > 0) && (
          <div className="progress-track" aria-label="Download progress">
            <i style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
        )}

        {status.state === 'available' && status.notes && <div className="release-notes">{status.notes}</div>}
        {status.checkedAt && (
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
            Last checked {new Date(status.checkedAt).toLocaleString()}
          </div>
        )}
      </div>
    </Card>
  );
}
