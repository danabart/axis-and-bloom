import { NavLink, Link, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext';

const NAV = [
  { to: '/admin',              label: 'Dashboard',       end: true },
  { to: '/admin/coffees',      label: 'Coffees'                   },
  { to: '/admin/sessions',     label: 'Cupping Sessions'          },
  { to: '/admin/cupping',      label: 'Score Entry'               },
  { to: '/admin/flavor-wheel', label: 'Flavor Wheel'              },
  { to: '/admin/roasters',     label: 'Roasteries'                },
  { to: '/admin/dial',         label: 'Bloom Dial'                },
];

export default function AdminLayout() {
  const { logout } = useAuth();
  const navigate   = useNavigate();

  const handleSignOut = async () => { await logout(); navigate('/'); };

  return (
    <div className="flex min-h-screen" style={{ fontFamily: 'inherit' }}>
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-stone-200 bg-stone-50 px-4 py-8 flex flex-col">
        <p className="text-xs font-normal tracking-widest uppercase mb-6" style={{ color: '#b05642' }}>
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
                    ? 'bg-stone-200 font-normal text-stone-800'
                    : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Back to site + Sign out */}
        <div className="mt-auto pt-6 border-t border-stone-200 flex flex-col gap-1">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-2 rounded text-sm text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 11.5L4 7l4.5-4.5" />
            </svg>
            Back to site
          </Link>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-3 py-2 rounded text-sm text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors text-left"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 2h3.5v10H9M6 10l3-3-3-3M9 7H2" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 p-8 overflow-auto bg-white">
        <Outlet />
      </main>
    </div>
  );
}
