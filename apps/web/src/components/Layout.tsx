import { Activity, Gauge, Globe, ListChecks, Menu, Moon, Network, Settings, Smartphone, Sun, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useActive } from '../api/hooks';
import { useServerEvents } from '../api/events';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/runs', label: 'Test runs', icon: ListChecks },
  { to: '/urls', label: 'URL lists', icon: Globe },
  { to: '/profiles', label: 'Device profiles', icon: Smartphone },
  { to: '/proxies', label: 'Proxies', icon: Network },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return [
    dark,
    () =>
      setDark((d) => {
        try {
          localStorage.setItem('theme', d ? 'light' : 'dark');
        } catch {
          /* storage unavailable */
        }
        return !d;
      }),
  ];
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white',
            )
          }
        >
          <Icon className="size-4.5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-5 py-4">
      <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm">
        <svg viewBox="0 0 32 32" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 11h13l-3.5-3.5M19 11l-3.5 3.5M26 21H13l3.5 3.5M13 21l3.5-3.5" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-slate-900 dark:text-white">Redirect Checker</span>
        <span className="block text-[11px] text-slate-500 dark:text-slate-400">Compatibility testing</span>
      </span>
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [dark, toggleTheme] = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { connected } = useServerEvents();
  const { data: active = [] } = useActive();
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const running = active.filter((a) => a.status === 'running');
  const done = running.reduce((s, r) => s + r.doneTasks, 0);
  const total = running.reduce((s, r) => s + r.totalTasks, 0);

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900">
        <Brand />
        <Sidebar />
        <div className="border-t border-slate-200 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className={cx('size-2 rounded-full', connected ? 'bg-emerald-500' : 'bg-slate-400')} />
            {connected ? 'Live updates connected' : 'Reconnecting…'}
          </span>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => setMobileOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-950/80">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          {running.length > 0 && (
            <Link
              to={running.length === 1 ? `/runs/${running[0]!.runId}` : '/runs?status=running'}
              className="hidden items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 sm:inline-flex dark:bg-indigo-500/15 dark:text-indigo-300"
            >
              <Activity className="size-3.5 animate-pulse" />
              {running.length} run{running.length > 1 ? 's' : ''} active · {total ? Math.floor((done / total) * 100) : 0}%
            </Link>
          )}
          <button onClick={toggleTheme} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white" aria-label="Toggle theme">
            {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
