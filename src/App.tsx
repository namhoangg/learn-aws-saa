import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useApplyTheme } from './lib/theme';
import { HomePage } from './pages/HomePage';
import { SectionPage } from './pages/SectionPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Heavier pages load on demand.
const ReviewPage = lazy(() => import('./pages/ReviewPage').then((m) => ({ default: m.ReviewPage })));
const PracticePage = lazy(() => import('./pages/PracticePage').then((m) => ({ default: m.PracticePage })));
const ExamPage = lazy(() => import('./pages/ExamPage').then((m) => ({ default: m.ExamPage })));
const ExamResultsPage = lazy(() => import('./pages/ExamResultsPage').then((m) => ({ default: m.ExamResultsPage })));
const WeakAreasPage = lazy(() => import('./pages/WeakAreasPage').then((m) => ({ default: m.WeakAreasPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const CheckPage = lazy(() => import('./pages/CheckPage').then((m) => ({ default: m.CheckPage })));
const VerifyPage = lazy(() => import('./pages/VerifyPage').then((m) => ({ default: m.VerifyPage })));

export function App() {
  useApplyTheme();
  return (
    <Layout>
      <ErrorBoundary>
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/section/:id" element={<SectionPage />} />
            <Route path="/section/:id/:tab" element={<SectionPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/exam" element={<ExamPage />} />
            <Route path="/exam/results/:attemptId" element={<ExamResultsPage />} />
            <Route path="/weak" element={<WeakAreasPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/check" element={<CheckPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
