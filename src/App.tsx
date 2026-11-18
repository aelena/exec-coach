import { useEffect, useState } from 'react';
import { bootstrap, loadRegistry } from './app/services';
import type { ContentRegistry } from './content/registry';
import type { AppSettings } from './domain/types';
import { LocaleContext, translate } from './i18n';
import { saveSettings } from './storage/db';
import { AppContext, useRoute, type AppState } from './ui/common';
import { Dashboard, MemoryScreen } from './ui/screens/Dashboard';
import { DialogueScreen } from './ui/screens/Dialogue';
import { Driving } from './ui/screens/Driving';
import { Compare, History, SessionDetail } from './ui/screens/History';
import { Home, Setup } from './ui/screens/Home';
import { Library } from './ui/screens/Library';
import { Onboarding } from './ui/screens/Onboarding';
import { SessionScreen } from './ui/screens/Session';
import { Settings } from './ui/screens/Settings';

const NAV = [
  { path: '', key: 'nav.train', icon: '◎' },
  { path: 'history', key: 'nav.history', icon: '☰' },
  { path: 'dashboard', key: 'nav.dashboard', icon: '▤' },
  { path: 'library', key: 'nav.library', icon: '❝' },
  { path: 'settings', key: 'nav.settings', icon: '⚙' },
];

function Screen({ route }: { route: string[] }) {
  const [head, a, b] = route;
  switch (head) {
    case undefined:
      return <Home />;
    case 'setup':
      return <Setup />;
    case 'session':
      return a ? <SessionScreen key={a} id={a} /> : <Home />;
    case 'dialogue':
      return a ? <DialogueScreen key={a} sessionId={a} /> : <History />;
    case 'history':
      return a ? <SessionDetail key={a} id={a} /> : <History />;
    case 'compare':
      return a && b ? <Compare a={a} b={b} /> : <History />;
    case 'dashboard':
      return <Dashboard />;
    case 'memory':
      return <MemoryScreen />;
    case 'library':
      return <Library />;
    case 'settings':
      return <Settings />;
    case 'driving':
      return <Driving />;
    default:
      return <Home />;
  }
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [registry, setRegistry] = useState<ContentRegistry | null>(null);
  const [failed, setFailed] = useState(false);
  const route = useRoute();

  useEffect(() => {
    bootstrap()
      .then((boot) => {
        setSettings(boot.settings);
        setRegistry(boot.registry);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (settings) document.documentElement.lang = settings.uiLocale;
  }, [settings?.uiLocale]);

  if (failed) return <p className="page">Local storage is unavailable in this browser session (IndexedDB). / El almacenamiento local no está disponible (IndexedDB).</p>;
  if (!settings || !registry) return null;

  const state: AppState = {
    settings,
    registry,
    async updateSettings(patch) {
      const next = { ...settings, ...patch };
      setSettings(next);
      await saveSettings(next);
    },
    async reloadRegistry() {
      setRegistry(await loadRegistry());
    },
  };
  const t = (key: string) => translate(settings.uiLocale, key);
  const inSession = route[0] === 'session' || route[0] === 'driving';

  return (
    <LocaleContext.Provider value={settings.uiLocale}>
      <AppContext.Provider value={state}>
        <a className="skip-link" href="#main">
          {t('a11y.skip')}
        </a>
        {!settings.onboarded ? (
          <Onboarding />
        ) : (
          <>
            <Screen route={route} />
            {!inSession && (
              <nav className="bottom-nav" aria-label={t('a11y.mainNav')}>
                {NAV.map((item) => {
                  const current = (route[0] ?? '') === item.path || (item.path === '' && route[0] === 'setup') || (item.path === 'dashboard' && route[0] === 'memory');
                  return (
                    <a key={item.path} href={`#/${item.path}`} aria-current={current ? 'page' : undefined}>
                      <span aria-hidden="true">{item.icon}</span>
                      {t(item.key)}
                    </a>
                  );
                })}
              </nav>
            )}
          </>
        )}
      </AppContext.Provider>
    </LocaleContext.Provider>
  );
}
