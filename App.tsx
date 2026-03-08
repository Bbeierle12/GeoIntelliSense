import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { UserPreferencesProvider } from './contexts/UserPreferencesContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen, DashboardSkeleton } from './components/LoadingStates';
import { ToastProvider } from './components/Toast';
import { SkipLinks, useKeyboardShortcuts, useAnnounce } from './utils/accessibility';
import Header from './components/Header';
import Sidebar from './components/Sidebar';

// Lazy load route components for code splitting
const Dashboard = lazy(() => import('./components/Dashboard'));
const AirQualityMapView = lazy(() => import('./components/AirQualityMapView'));
const AnalysisView = lazy(() => import('./components/AnalysisView'));
const DataExplorer = lazy(() => import('./components/DataExplorer'));
const SettingsView = lazy(() => import('./components/SettingsView'));

// Loading fallback for lazy-loaded routes
const RouteLoadingFallback: React.FC = () => (
  <div className="p-4 md:p-6 lg:p-8">
    <DashboardSkeleton />
  </div>
);

// Layout component with keyboard shortcuts
const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const announce = useAnnounce();

  // Define keyboard shortcuts for navigation
  const shortcuts = [
    {
      key: 'd',
      altKey: true,
      action: () => {
        navigate('/dashboard');
        announce('Navigated to Dashboard');
      },
      description: 'Go to Dashboard'
    },
    {
      key: 'm',
      altKey: true,
      action: () => {
        navigate('/air-quality-map');
        announce('Navigated to Air Quality Map');
      },
      description: 'Go to Air Quality Map'
    },
    {
      key: 'e',
      altKey: true,
      action: () => {
        navigate('/explore');
        announce('Navigated to Data Explorer');
      },
      description: 'Go to Data Explorer'
    },
    {
      key: 'a',
      altKey: true,
      action: () => {
        navigate('/analysis');
        announce('Navigated to Analysis');
      },
      description: 'Go to Analysis'
    },
    {
      key: 's',
      altKey: true,
      action: () => {
        navigate('/settings');
        announce('Navigated to Settings');
      },
      description: 'Go to Settings'
    },
    {
      key: '?',
      shiftKey: true,
      action: () => {
        announce('Keyboard shortcuts: Alt+D for Dashboard, Alt+M for Air Quality Map, Alt+A for Analysis, Alt+S for Settings');
      },
      description: 'Show keyboard shortcuts'
    }
  ];

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="flex h-screen bg-brand-bg-dark font-sans">
      <SkipLinks />
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main 
          id="main-content"
          className="flex-1 overflow-x-hidden overflow-y-auto bg-brand-bg-dark p-4 md:p-6 lg:p-8"
          role="main"
          aria-label="Main content"
        >
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
      {/* Live region for screen reader announcements */}
      <div 
        id="live-region"
        role="status" 
        aria-live="polite" 
        aria-atomic="true" 
        className="sr-only"
      />
    </div>
  );
};

const App: React.FC = () => {
  // Add global focus visible styles
  useEffect(() => {
    // Add class to enable focus-visible polyfill behavior
    document.documentElement.classList.add('js-focus-visible');
  }, []);

  return (
    <ErrorBoundary>
      <UserPreferencesProvider>
        <ToastProvider>
        <Router>
          <Suspense fallback={<LoadingScreen message="Loading GeoIntelliSense..." />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route
                path="/dashboard"
                element={
                  <Layout>
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <Dashboard />
                    </Suspense>
                  </Layout>
                }
              />
              <Route
                path="/air-quality-map"
                element={
                  <Layout>
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <AirQualityMapView />
                    </Suspense>
                  </Layout>
                }
              />
              <Route
                path="/analysis"
                element={
                  <Layout>
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <AnalysisView />
                    </Suspense>
                  </Layout>
                }
              />
              <Route
                path="/explore"
                element={
                  <Layout>
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <DataExplorer />
                    </Suspense>
                  </Layout>
                }
              />
              <Route
                path="/settings"
                element={
                  <Layout>
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <SettingsView />
                    </Suspense>
                  </Layout>
                }
              />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </Router>
        </ToastProvider>
      </UserPreferencesProvider>
    </ErrorBoundary>
  );
};

export default App;