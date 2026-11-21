import { Check, Palette } from 'lucide-react';
import { Card } from './ui';
import { useApp } from '../store/AppContext';
import { THEMES } from '../lib/themes';

/**
 * Settings → Appearance.
 *
 * Every preset previews its own surfaces, navigation colour and accent.
 * Selecting one applies instantly (no reload) and syncs to the signed-in
 * account so the other devices pick it up.
 */
export function AppearanceCard() {
  const app = useApp();

  return (
    <Card title="Appearance" right={<Palette size={18} color="var(--text-3)" />}>
      <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>
        Pick a theme — it applies immediately on Windows, Android and the web, syncs with your account, and is
        remembered on this device for the next launch. Printed invoices always stay in the classic ink palette.
      </div>
      <div className="theme-grid" role="radiogroup" aria-label="Appearance theme">
        {THEMES.map((theme) => {
          const active = app.theme === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`theme-option${active ? ' active' : ''}`}
              onClick={() => app.setTheme(theme.id)}
              title={theme.description}
            >
              <div className="theme-preview" style={{ background: theme.swatch.bg }}>
                <div className="theme-preview-nav" style={{ background: theme.swatch.nav, color: '#ffffff' }}>
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div className="theme-preview-body" style={{ background: theme.swatch.card, color: theme.swatch.brand }}>
                  <b />
                  <b />
                  <b style={{ width: '78%' }} />
                  <em>
                    <span />
                    <span />
                  </em>
                </div>
              </div>
              <div className="theme-name">
                <span>{theme.name}</span>
                {active ? (
                  <Check size={15} className="theme-check" />
                ) : theme.id === 'sk-classic' ? (
                  <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700 }}>DEFAULT</span>
                ) : null}
              </div>
              <div className="theme-desc">{theme.description}</div>
            </button>
          );
        })}
      </div>
      {app.preview && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)' }}>
          Theme changes in Preview are not saved to an account.
        </div>
      )}
    </Card>
  );
}
