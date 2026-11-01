import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Button, EmptyState, LoadingBlock } from './components/ui';
import { Dashboard } from './pages/Dashboard';

const Runs = lazy(() => import('./pages/Runs').then((m) => ({ default: m.Runs })));
const NewRun = lazy(() => import('./pages/NewRun').then((m) => ({ default: m.NewRun })));
const RunDetail = lazy(() => import('./pages/RunDetail').then((m) => ({ default: m.RunDetail })));
const UrlLists = lazy(() => import('./pages/UrlLists').then((m) => ({ default: m.UrlLists })));
const UrlListDetail = lazy(() => import('./pages/UrlListDetail').then((m) => ({ default: m.UrlListDetail })));
const Profiles = lazy(() => import('./pages/Profiles').then((m) => ({ default: m.Profiles })));
const Proxies = lazy(() => import('./pages/Proxies').then((m) => ({ default: m.Proxies })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override render() {
    if (this.state.error) {
      return (
        <EmptyState
          title="Something went wrong on this page"
          description={this.state.error.message}
          action={<Button onClick={() => this.setState({ error: null })}>Try again</Button>}
        />
      );
    }
    return this.props.children;
  }
}

export function App() {
  const location = useLocation();
  return (
    <Layout>
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<LoadingBlock />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/runs/new" element={<NewRun />} />
            <Route path="/runs/:id" element={<RunDetail />} />
            <Route path="/urls" element={<UrlLists />} />
            <Route path="/urls/:id" element={<UrlListDetail />} />
            <Route path="/profiles" element={<Profiles />} />
            <Route path="/proxies" element={<Proxies />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<EmptyState title="Page not found" description="The page you are looking for does not exist." />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
