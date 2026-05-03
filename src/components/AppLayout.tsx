import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FileBarChart, Settings, Users, LogOut,
  Plug, PackageCheck, Shield, ArrowLeftRight, Boxes, FlaskConical,
  Menu, X,
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
  { to: "/dashboard",        label: "Dashboard",            icon: LayoutDashboard },
  { to: "/exportacoes",      label: "Exportações",           icon: PackageCheck },
  { to: "/relatorios",       label: "Relatórios",            icon: FileBarChart },
  { to: "/configuracoes",    label: "Configurações",         icon: Settings },
  { to: "/integracoes",      label: "Layout do ERP",         icon: Plug, adminOnly: true },
  { to: "/de-para",          label: "Mapeamento de códigos", icon: ArrowLeftRight },
  { to: "/catalogo-produtos",label: "Catálogo",              icon: Boxes },
  { to: "/equipe",           label: "Equipe",                icon: Users },
];

// Três estados: "expanded" (desktop) | "collapsed" (tablet, só ícones) | "hidden" (mobile)
type SidebarState = "expanded" | "collapsed" | "hidden";

function getSidebarState(width: number): SidebarState {
  if (width >= 1024) return "expanded";
  if (width >= 640)  return "collapsed";
  return "hidden";
}

export function AppLayout() {
  const { user, papel, isSuperAdmin, nomeTenant, isDemoTenant, signOut } = useAuth();
  const navigate = useNavigate();

  // Estado calculado a partir da largura da janela
  const [sidebarState, setSidebarState] = useState<SidebarState>(
    getSidebarState(typeof window !== "undefined" ? window.innerWidth : 1280)
  );
  // Drawer aberto no mobile
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      setSidebarState(getSidebarState(window.innerWidth));
      if (window.innerWidth >= 640) setDrawerOpen(false);
    };
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const collapsed = sidebarState === "collapsed";
  const isMobile = sidebarState === "hidden";

  // Largura real da sidebar (usada para deslocar o conteúdo)
  const sidebarWidthClass = collapsed ? "w-16" : "w-64";
  const mainMarginClass = isMobile ? "ml-0" : collapsed ? "ml-16" : "ml-64";

  const NavContent = ({ inDrawer = false }: { inDrawer?: boolean }) => {
    const isCollapsed = !inDrawer && collapsed;
    return (
      <>
        {/* Logo */}
        <div className={cn(
          "flex h-16 shrink-0 items-center border-b border-sidebar-border transition-all duration-200",
          isCollapsed ? "justify-center px-2" : "px-5",
        )}>
          {isCollapsed ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground font-bold text-sm select-none">
              S
            </span>
          ) : (
            <SofteumLogo variant="dark" />
          )}
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-4">
          {isSuperAdmin && (
            <>
              <NavLink
                to="/admin"
                onClick={() => setDrawerOpen(false)}
                title={isCollapsed ? "Painel Admin" : undefined}
                className={({ isActive }) => cn(
                  "group flex min-h-[44px] items-center rounded-lg text-sm font-medium transition-colors",
                  isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Shield size={18} strokeWidth={2} className="shrink-0" />
                {!isCollapsed && <span className="truncate">Painel Admin</span>}
              </NavLink>
              <div className="my-2 h-px bg-sidebar-border/50" />
            </>
          )}

          {navItems.map((item) => {
            if (item.adminOnly && papel !== "admin" && !isSuperAdmin) return null;
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                title={isCollapsed ? item.label : undefined}
                className={({ isActive }) => cn(
                  "group flex min-h-[44px] items-center rounded-lg text-sm font-medium transition-colors",
                  isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon size={18} strokeWidth={2} className="shrink-0" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Tenant info */}
        {!isCollapsed && nomeTenant && (
          <div className="shrink-0 border-t border-sidebar-border px-5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">Empresa</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-sidebar-foreground">{nomeTenant}</p>
          </div>
        )}

        {/* User + logout */}
        <div className="shrink-0 border-t border-sidebar-border p-2">
          {!isCollapsed && (
            <div className="mb-1 px-2 py-1">
              <p className="truncate text-xs text-sidebar-muted">{user?.email}</p>
              {papel && (
                <p className="text-[11px] font-medium uppercase tracking-wider text-sidebar-muted/70">
                  {papel === "admin" ? "Administrador" : "Membro"}
                </p>
              )}
            </div>
          )}
          <button
            onClick={handleSignOut}
            title={isCollapsed ? "Sair" : undefined}
            className={cn(
              "flex min-h-[44px] w-full items-center rounded-lg text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              isCollapsed ? "justify-center px-2" : "gap-2 px-3",
            )}
          >
            <LogOut size={16} className="shrink-0" />
            {!isCollapsed && "Sair"}
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="flex min-h-screen w-full bg-background">

      {/* ── Sidebar fixa (tablet + desktop) ── */}
      {!isMobile && (
        <aside className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-200",
          sidebarWidthClass,
        )}>
          <NavContent />
        </aside>
      )}

      {/* ── Drawer backdrop (mobile) ── */}
      {isMobile && drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Drawer (mobile) ── */}
      {isMobile && (
        <aside className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-200",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}>
          <button
            onClick={() => setDrawerOpen(false)}
            className="absolute right-3 top-3.5 rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            aria-label="Fechar menu"
          >
            <X size={18} />
          </button>
          <NavContent inDrawer />
        </aside>
      )}

      {/* ── Conteúdo principal ── */}
      <main className={cn(
        "flex min-w-0 flex-1 flex-col overflow-x-hidden transition-[margin] duration-200",
        mainMarginClass,
      )}>

        {/* Banner super admin */}
        {isSuperAdmin && !isDemoTenant && nomeTenant && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-indigo-300 bg-indigo-100 px-4 py-2 text-indigo-900 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <Shield size={14} className="shrink-0" />
              <span className="hidden sm:inline">SUPER ADMIN — Visualizando:</span>
              <span className="truncate font-bold">{nomeTenant}</span>
            </div>
            <button
              onClick={() => navigate("/admin")}
              className="shrink-0 rounded-md border border-indigo-400 bg-white px-2.5 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-50"
            >
              ← Admin
            </button>
          </div>
        )}

        {/* Banner demo */}
        {isDemoTenant && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-amber-900 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <FlaskConical size={14} className="shrink-0" />
              <span className="truncate">MODO DEMO — dados fictícios</span>
            </div>
            {isSuperAdmin && (
              <button
                onClick={() => navigate("/admin/modo-demo")}
                className="shrink-0 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-50"
              >
                Sair
              </button>
            )}
          </div>
        )}

        {/* Header fixo */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          {/* Hambúrguer — só mobile */}
          {isMobile && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="mr-3 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Abrir menu"
            >
              <Menu size={20} />
            </button>
          )}
          <div className="flex-1" />
          <NotificationBell />
        </header>

        {/* Página */}
        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
