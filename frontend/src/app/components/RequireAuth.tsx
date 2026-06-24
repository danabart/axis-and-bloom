import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';

export default function RequireAuth({
  children,
  redirectTo,
}: {
  children: React.ReactNode;
  redirectTo?: string;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#f2f1ea' }}>
        <p className="text-xs uppercase tracking-widest opacity-40" style={{ color: '#a33726' }}>Loading…</p>
      </div>
    );
  }

  if (!user) {
    const to = redirectTo ?? `/sign-in?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
}
