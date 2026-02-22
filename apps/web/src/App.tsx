import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import ProtectedRoute from './components/shared/ProtectedRoute.js';
import AppLayout from './components/shared/AppLayout.js';

const LoginPage = lazy(() => import('./pages/auth/LoginPage.js'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage.js'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage.js'));

// Placeholder pages for routes that are built in later stages
const PlaceholderPage = ({ title }: { title: string }) => (
  <div className="text-center py-20">
    <h2 className="text-2xl font-bold text-muted-foreground">{title}</h2>
    <p className="text-muted-foreground mt-2">Coming soon — implementation in progress</p>
  </div>
);

export default function App() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading…</div>}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/assignments" element={<PlaceholderPage title="Assignments" />} />
            <Route path="/clients" element={<PlaceholderPage title="Clients" />} />
            <Route path="/documents" element={<PlaceholderPage title="Documents" />} />
            <Route path="/valuation" element={<PlaceholderPage title="Valuation Workbench" />} />
            <Route path="/reports" element={<PlaceholderPage title="Reports" />} />
          </Route>
        </Route>

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
