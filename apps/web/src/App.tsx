import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Empty, Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { Login } from './pages/Login';

const Board = lazy(() => import('./pages/Board'));
const NewAssignment = lazy(() => import('./pages/NewAssignment'));
const CaseWorkspace = lazy(() => import('./pages/case/CaseWorkspace'));
const Formats = lazy(() => import('./pages/Formats'));
const Settings = lazy(() => import('./pages/Settings'));
const MasterData = lazy(() => import('./pages/admin/MasterData'));
const DataPage = lazy(() => import('./pages/DataPage'));
const EngineerVisit = lazy(() => import('./pages/EngineerVisit'));

const Next = ({ title, what }: { title: string; what: string }) => (
  <Empty title={title}>{what} Coming soon: it follows the first SBI flat case signed end to end (Gate A).</Empty>
);

export function App() {
  const { user, ready } = useAuth();
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/v/:token" element={<EngineerVisit />} />
        {!ready ? (
          <Route path="*" element={<Loading what="Starting" />} />
        ) : !user ? (
          <Route path="*" element={<Login />} />
        ) : (
          <Route element={<Shell />}>
            <Route index element={<Board />} />
            <Route path="new" element={<NewAssignment />} />
            <Route path="cases/:id/*" element={<CaseWorkspace />} />
            <Route path="formats/*" element={<Formats />} />
            <Route path="settings/*" element={<Settings />} />
            <Route path="master/*" element={<MasterData />} />
            <Route path="data" element={<DataPage />} />
            <Route path="quick-estimate" element={<Next title="Quick Estimate" what="Read an Index II or type the area, confirm, and get a calculated estimate with a note for the banker; convert it to a full case." />} />
            <Route path="billing" element={<Next title="Billing & payouts" what="GST invoices per case or monthly batch, payments with TDS, ageing, accounting exports and engineer payouts." />} />
            <Route path="analytics" element={<Next title="Reports & analytics" what="Throughput, turnaround by stage, banks, localities and engineers, with CSV export." />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </Suspense>
  );
}
