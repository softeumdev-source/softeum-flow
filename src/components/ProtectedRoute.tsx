import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ReactNode } from "react";

interface ProtectedRouteProps {
  children: ReactNode;
  requireSuperAdmin?: boolean;
  requireAdminTenant?: boolean;
}

export function ProtectedRoute({ children, requireSuperAdmin, requireAdminTenant }: ProtectedRouteProps) {
  const { user, loading, isSuperAdmin, papel } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireAdminTenant && papel !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
