import { Navigate } from 'react-router';
import { useAuth } from '../../context/AuthContext';

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-screen text-sm opacity-50">Loading…</div>;
  if (!user || !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
