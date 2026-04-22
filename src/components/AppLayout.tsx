import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, FileBarChart, Settings, Users, LogOut, Plug, PackageCheck, Shield, KeyRound } from "lucide-react";
import { SofteumLogo } from "@/components/SofteumLogo";
import { useAuth } from "@/contexts/AuthContext";
import { AlterarSenhaDialog } from "@/components/equipe/AlterarSenhaDialog";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/exportacoes", label: "Exportações", icon: PackageCheck },
  { to: "/relatorios", label: "Relatórios", icon: FileBarChart },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
  { to: "/integracoes", label: "Integrações", icon: Plug },
  { to: "/equipe", label: "Equipe", icon: Users, adminOnly: true },
];

export function AppLayout() {
  const { user, papel, isSuperAdmin, nomeTenant, signOut } = useAuth();
  const navigate = useNavigate();
  const [senhaOpen, setSenhaOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground">
        {/* Logo */}
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <SofteumLogo variant="dark" />
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-3 py-5">
          {isSuperAdmin && (
            <>
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "bg-primary/15 text-primary hover:bg-primary/25",
                  )
                }
              >
                <Shield size={18} strokeWidth={2} />
                Painel Admin
              </NavLink>
              <div className="my-2 h-px bg-sidebar-border" />
            </>
          )}
          {navItems.map((item) => {
            if (item.adminOnly && papel !== "admin" && !isSuperAdmin) return null;
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  )
                }
              >
                <Icon className="h-4.5 w-4.5" strokeWidth={2} size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Tenant */}
        {nomeTenant && (
          <div className="border-t border-sidebar-border px-5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">
              Empresa
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-sidebar-foreground">
              {nomeTenant}
            </p>
          </div>
        )}

        {/* User + sair */}
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 px-2 py-1">
            <p className="truncate text-xs text-sidebar-muted">{user?.email}</p>
            {papel && (
              <p className="text-[11px] font-medium uppercase tracking-wider text-sidebar-muted/80">
                {papel === "admin" ? "Administrador" : "Operador"}
              </p>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="ml-64 flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
