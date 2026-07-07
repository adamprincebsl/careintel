import { NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Sparkles, UserSearch, Settings, Database, ShieldAlert } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';

const linkBase = 'flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors';
const on = 'bg-white/15 text-white';
const off = 'text-white/80 hover:bg-white/10 hover:text-white';
const navClass = ({ isActive }) => `${linkBase} ${isActive ? on : off}`;

// Compliance is a module spanning several routes; highlight it across all of them.
const COMPLIANCE_RE = /^\/c360(\/(incidents|incident-compliance|incident-rules|residential|market-documentation|enhanced-staffing))?$/;

export default function TopNav() {
  const { user, settings } = useAuth();
  const features = settings?.features || {};
  const { pathname } = useLocation();
  const complianceActive = COMPLIANCE_RE.test(pathname);

  return (
    <header className="bg-beacon text-white shadow">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-gold" />
          <span className="text-base font-semibold tracking-tight">Beacon Care Intelligence</span>
        </div>
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={navClass}>
            <BarChart3 className="h-4 w-4" /> Dashboard
          </NavLink>
          {features.assistant !== false && (
            <NavLink to="/assistant" className={navClass}>
              <Sparkles className="h-4 w-4" /> Insights
            </NavLink>
          )}
          {features.c360 !== false && can(user, 'report.view') && (
            <NavLink to="/c360/incidents" className={`${linkBase} ${complianceActive ? on : off}`}>
              <ShieldAlert className="h-4 w-4" /> Compliance
            </NavLink>
          )}
          {can(user, 'note.viewPhi') && (
            <NavLink to="/c360/client" className={navClass}>
              <UserSearch className="h-4 w-4" /> Client
            </NavLink>
          )}
          {can(user, 'c360.query') && (
            <NavLink to="/c360/explore" className={navClass}>
              <Database className="h-4 w-4" /> Explore
            </NavLink>
          )}
          {can(user, 'admin.manage') && (
            <NavLink to="/admin/users" className={navClass}>
              <Settings className="h-4 w-4" /> Admin
            </NavLink>
          )}
        </nav>
        <div className="ml-auto text-sm text-white/80">
          {user?.name || user?.email || 'Signed in'}
        </div>
      </div>
    </header>
  );
}
