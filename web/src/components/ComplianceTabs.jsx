// Sub-navigation for the Compliance module.
import { NavLink } from 'react-router-dom';

const tab = ({ isActive }) =>
  `rounded px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-beacon text-white' : 'text-beacon hover:bg-beacon/5'}`;

export default function ComplianceTabs() {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border pb-2">
      <NavLink to="/c360/incidents" className={tab}>Incidents</NavLink>
      <NavLink to="/c360/incident-compliance" className={tab}>Incident Compliance</NavLink>
      <NavLink to="/c360/residential" className={tab}>Documentation</NavLink>
    </div>
  );
}
