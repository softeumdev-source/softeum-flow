import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Building2, LogOut, ArrowRight, BarChart2, AlertTriangle, Settings, FlaskConical } from "lucide-react";
import { SofteumLogo } from "@/components/SofteumLogo";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/admin", label: "Painel Admin", icon: LayoutDashboard, end: true },
  { to: "/admin/tenants", label: "Clientes", icon: Building2 },
  { to: "/admin/uso", label: "Uso geral", icon: BarChart2 },
  { to: "/admin/erros", label: "Erros do sistema", icon: AlertTriangle },
  { to: "/admin/configuracoes", label: "Configurações admin", icon: Settings },
  { to: "/admin/modo-demo", label: "Modo Demo", icon: FlaskConical },
];

export function AdminLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };
  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <SofteumLogo variant="dark" />
        </div>
        <div className="border-b border-sidebar-border px-5 py-2.5">
          <span className="inline-flex items-center rounded-full bg-sidebar-accent px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-accent-foreground">
            Super Admin
          </span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  )
                }
              >
                <Icon size={18} strokeWidth={2} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="px-3 pb-2">
          <NavLink
            to="/dashboard"
            className="flex items-center gap-3 rounded-lg border border-dashed border-sidebar-border px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:border-sidebar-accent hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
          >
            <ArrowRight size={18} strokeWidth={2} />
            Acessar sistema
          </NavLink>
        </div>
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 px-2 py-1">
            <p className="truncate text-xs text-sidebar-muted">{user?.email}</p>
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
      <main className="ml-64 flex flex-1 flex-col overflow-x-hidden">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-end border-b border-border bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <NotificationBell scope="system" />
        </header>
        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
