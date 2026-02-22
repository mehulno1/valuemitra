import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import ProtectedRoute from './components/shared/ProtectedRoute.js';
import AppLayout from './components/shared/AppLayout.js';
import { LoadingSpinner } from './components/shared/LoadingSpinner.js';

const LoginPage          = lazy(() => import('./pages/auth/LoginPage.js'));
const RegisterPage       = lazy(() => import('./pages/auth/RegisterPage.js'));
const DashboardPage      = lazy(() => import('./pages/dashboard/DashboardPage.js'));
const ClientsPage        = lazy(() => import('./pages/clients/ClientsPage.js'));
const NewClientPage      = lazy(() => import('./pages/clients/NewClientPage.js'));
const ClientDetailPage   = lazy(() => import('./pages/clients/ClientDetailPage.js'));
const AssignmentsPage    = lazy(() => import('./pages/assignments/AssignmentsPage.js'));
const NewAssignmentPage  = lazy(() => import('./pages/assignments/NewAssignmentPage.js'));
const AssignmentDetailPage = lazy(() => import('./pages/assignments/AssignmentDetailPage.js'));

export default function App() {
  return (
    <Suspense fallback={<LoadingSpinner className="h-screen" />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard"                  element={<DashboardPage />} />
            <Route path="/clients"                    element={<ClientsPage />} />
            <Route path="/clients/new"                element={<NewClientPage />} />
            <Route path="/clients/:clientId"          element={<ClientDetailPage />} />
            <Route path="/assignments"                element={<AssignmentsPage />} />
            <Route path="/assignments/new"            element={<NewAssignmentPage />} />
            <Route path="/assignments/:assignmentId"  element={<AssignmentDetailPage />} />
            <Route path="/documents"  element={<Navigate to="/assignments" replace />} />
            <Route path="/valuation"  element={<Navigate to="/assignments" replace />} />
            <Route path="/reports"    element={<Navigate to="/assignments" replace />} />
          </Route>
        </Route>

        <Route path="/"  element={<Navigate to="/dashboard" replace />} />
        <Route path="*"  element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
