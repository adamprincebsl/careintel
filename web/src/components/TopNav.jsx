import { NavLink } from 'react-router-dom';
import { BarChart3, MessageSquareText, Sparkles, UserSearch, Settings } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';

const linkBase = 'flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors';

function navClass({ isActive }) {
  return `${linkBase} ${isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'}`;
}

export default function TopNav() {
  const { user } = useAuth();
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
          <NavLink to="/assistant" className={navClass}>
            <MessageSquareText className="h-4 w-4" /> Assistant
          </NavLink>
          {can(user, 'client.viewPii') && (
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
