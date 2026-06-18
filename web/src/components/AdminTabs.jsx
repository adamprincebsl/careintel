import { NavLink } from 'react-router-dom';

const tab = ({ isActive }) =>
  `border-b-2 px-3 py-2 text-sm font-medium ${
    isActive ? 'border-beacon text-beacon' : 'border-transparent text-ink-muted hover:text-ink'
  }`;

// Shared sub-navigation for the admin section.
export default function AdminTabs() {
  return (
    <nav className="mb-4 flex gap-2 border-b border-border">
      <NavLink to="/admin/users" className={tab}>Users</NavLink>
      <NavLink to="/admin/roles" className={tab}>Roles</NavLink>
      <NavLink to="/admin/settings" className={tab}>Settings</NavLink>
      <NavLink to="/admin/audit" className={tab}>Audit</NavLink>
    </nav>
  );
}
