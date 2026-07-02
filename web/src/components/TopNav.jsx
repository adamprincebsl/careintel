import { NavLink } from 'react-router-dom';
import { BarChart3, MessageSquareText, Sparkles, UserSearch, Settings, Database, ClipboardList, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';

const linkBase = 'flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors';

function navClass({ isActive }) {
  return `${linkBase} ${isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'}`;
}

export default function TopNav() {
  const { user, settings } = useAuth();
  const features = settings?.features || {};
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
              <MessageSquareText className="h-4 w-4" /> Assistant
            </NavLink>
          )}
          {features.c360 !== false && can(user, 'report.view') && (
            <NavLink to="/c360" className={navClass}>
              <Database className="h-4 w-4" /> c360
            </NavLink>
          )}
          {features.c360 !== false && can(user, 'report.view') && (
            <NavLink to="/c360/residential" className={navClass}>
              <ClipboardList className="h-4 w-4" /> Res Notes
            </NavLink>
          )}
          {features.c360 !== false && can(user, 'report.view') && (
            <NavLink to="/c360/incidents" className={navClass}>
              <AlertTriangle className="h-4 w-4" /> Incidents
            </NavLink>
          )}
          {features.c360 !== false && can(user, 'report.view') && (
            <NavLink to="/c360/incident-compliance" className={navClass}>
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
          {can(user, 'client.viewInitials') && (
            <NavLink to="/clients" className={navClass}>
              <UserSearch className="h-4 w-4" /> Clients
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
