import { Routes, Route } from 'react-router-dom';
import TopNav from './components/TopNav';
import { useAuth } from './lib/auth-context';
import Dashboard from './pages/Dashboard';
import Assistant from './pages/Assistant';
import ClientDetail from './pages/ClientDetail';
import AdminUsers from './pages/AdminUsers';
import AdminSettings from './pages/AdminSettings';
import C360Reports from './pages/C360Reports';

export default function App() {
  const { loading, error, user } = useAuth();

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-ink-muted">Loading…</div>;
  }
  if (error) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="max-w-md rounded border border-border bg-white p-6 text-center shadow">
          <h1 className="mb-2 text-lg font-semibold text-danger">Couldn’t load your session</h1>
          <p className="text-sm text-ink-muted">{String(error.message || error)}</p>
        </div>
      </div>
    );
  }
  if (user && user.provisioned === false) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="max-w-md rounded border border-border bg-white p-6 text-center shadow">
          <h1 className="mb-2 text-lg font-semibold">Account not provisioned</h1>
          <p className="text-sm text-ink-muted">
            You’re signed in as {user.email}, but no Beacon Care Intelligence roles are
            assigned yet. An administrator needs to grant you access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/assistant" element={<Assistant />} />
          <Route path="/c360" element={<C360Reports />} />
          <Route path="/clients" element={<ClientDetail />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/settings" element={<AdminSettings />} />
        </Routes>
      </main>
    </div>
  );
}
