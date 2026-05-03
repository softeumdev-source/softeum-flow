import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FileBarChart, Settings, Users, LogOut,
  Plug, PackageCheck, Shield, ArrowLeftRight, Boxes, FlaskConical, Menu, X,
} from "lucide-react";
import { SofteumLogo } from "@/components/SofteumLogo";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
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
  { to: "/integracoes", label: "Layout do ERP", icon: Plug, adminOnly: true },
  { to: "/de-para", label: "Mapeamento de códigos", icon: ArrowLeftRight },
  { to: "/catalogo-produtos", label: "Catálogo", icon: Boxes },
  { to: "/equipe", label: "Equipe", icon: Users },
];

export function AppLayout() {
  const { user, papel, isSuperAdmin, nomeTenant, isDemoTenant, signOut } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const closDrawer = () => setDrawerOpen(false);

  const SidebarContent = ({ collapsed }: { collapsed?: boolean }) => (
    <>
      {/* Logo */}
      <div className={cn(
        "flex h-16 items-center border-b border-sidebar-border",
        collapsed ? "justify-center px-2" : "px-5",
      )}>
        {collapsed ? (
          <div className="h-7 w-7 rounded-md bg-sidebar-accent flex items-center justify-center text-sidebar-accent-foreground font-bold text-sm">S</div>
        ) : (
          <SofteumLogo variant="dark" />
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-2 py-5 overflow-y-auto">
        {isSuperAdmin && (
          <>
            <NavLink
              to="/admin"
              onClick={closDrawer}
              className={({ isActive }) =>
                cn(
                  "flex items-center rounded-lg py-2.5 text-sm font-medium transition-colors",
                  collapsed ? "justify-center px-2" : "gap-3 px-3",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )
              }
              title={collapsed ? "Painel Admin" : undefined}
            >
              <Shield size={18} strokeWidth={2} className="shrink-0" />
              {!collapsed && "Painel Admin"}
            </NavLink>
            <div className="my-3 h-px bg-sidebar-border/60" />
          </>
        )}
        {navItems.map((item) => {
          if (item.adminOnly && papel !== "admin" && !isSuperAdmin) return null;
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closDrawer}
              className={({ isActive }) =>
                cn(
                  "flex items-center rounded-lg py-2.5 text-sm font-medium transition-colors",
                  collapsed ? "justify-center px-2" : "gap-3 px-3",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )
              }
              title={collapsed ? item.label : undefined}
            >
              <Icon className="shrink-0" strokeWidth={2} size={18} />
              {!collapsed && item.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Tenant */}
      {!collapsed && nomeTenant && (
        <div className="border-t border-sidebar-border px-5 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">Empresa</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-sidebar-foreground">{nomeTenant}</p>
        </div>
      )}

      {/* User + sair */}
      <div className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="mb-2 px-2 py-1">
            <p className="truncate text-xs text-sidebar-muted">{user?.email}</p>
            {papel && (
              <p className="text-[11px] font-medium uppercase tracking-wider text-sidebar-muted/80">
                {papel === "admin" ? "Administrador" : "Membro"}
              </p>
            )}
          </div>
        )}
        <button
          onClick={handleSignOut}
          className={cn(
            "flex w-full items-center rounded-lg py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            collapsed ? "justify-center px-2" : "gap-2 px-3",
          )}
          title={collapsed ? "Sair" : undefined}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && "Sair"}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen w-full bg-background">

      {/* ── Tablet sidebar (icon-only, 640–1024px) ── */}
      <aside className="hidden sm:flex lg:hidden fixed inset-y-0 left-0 z-40 w-16 flex-col bg-sidebar text-sidebar-foreground">
        <SidebarContent collapsed />
      </aside>

      {/* ── Desktop sidebar (full, >1024px) ── */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-64 flex-col bg-sidebar text-sidebar-foreground">
        <SidebarContent />
      </aside>

      {/* ── Mobile drawer backdrop ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
          onClick={closDrawer}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar text-sidebar-foreground transition-transform duration-200 sm:hidden",
        drawerOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <button
          onClick={closDrawer}
          className="absolute right-3 top-3 rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent/60"
        >
          <X className="h-5 w-5" />
        </button>
        <SidebarContent />
      </aside>

      {/* ── Main content ── */}
      <main className="flex flex-1 flex-col overflow-x-hidden ml-0 sm:ml-16 lg:ml-64">
        {isSuperAdmin && !isDemoTenant && nomeTenant && (
          <div className="flex items-center justify-between gap-3 border-b border-indigo-300 bg-indigo-100 px-6 py-2 text-indigo-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Shield className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">SUPER ADMIN — Visualizando dados do tenant:</span>
              <span className="font-bold">{nomeTenant}</span>
            </div>
            <button
              onClick={() => navigate("/admin")}
              className="shrink-0 rounded-md border border-indigo-400 bg-white px-2.5 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-50"
            >
              Voltar ao admin
            </button>
          </div>
        )}
        {isDemoTenant && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-6 py-2 text-amber-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">MODO DEMO ATIVO — dados fictícios.</span>
              <span className="sm:hidden">Modo Demo</span>
            </div>
            {isSuperAdmin && (
              <button
                onClick={() => navigate("/admin/modo-demo")}
                className="shrink-0 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-50"
              >
                Sair do demo
              </button>
            )}
          </div>
        )}

        {/* Header */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:justify-end">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <NotificationBell />
        </header>

        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
