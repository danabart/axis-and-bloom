import { NavLink, Outlet } from 'react-router';

const NAV = [
  { to: '/admin',              label: 'Dashboard',    end: true },
  { to: '/admin/coffees',      label: 'Coffees'             },
  { to: '/admin/sessions',     label: 'Cupping Sessions'    },
  { to: '/admin/flavor-wheel', label: 'Flavor Wheel'        },
];

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen pt-16" style={{ fontFamily: 'inherit' }}>
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-stone-200 bg-stone-50 px-4 py-8">
        <p className="text-xs font-semibold tracking-widest uppercase mb-6" style={{ color: '#b05642' }}>
          Admin
        </p>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-stone-200 font-medium text-stone-800'
                    : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 p-8 overflow-auto bg-white">
        <Outlet />
      </main>
    </div>
  );
}
