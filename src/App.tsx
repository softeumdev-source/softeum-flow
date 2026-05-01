import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { AdminLayout } from "@/components/AdminLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Exportacoes from "./pages/Exportacoes";
import PedidoDetalhe from "./pages/PedidoDetalhe";
import Relatorios from "./pages/Relatorios";
import Configuracoes from "./pages/Configuracoes";
import Equipe from "./pages/Equipe";
import Integracoes from "./pages/Integracoes";
import DePara from "./pages/DePara";
import CatalogoProdutos from "./pages/CatalogoProdutos";
import AdminDashboard from "./pages/AdminDashboard";
import AdminTenants from "./pages/AdminTenants";
import AdminTenantDetalhe from "./pages/AdminTenantDetalhe";
import AdminErros from "./pages/AdminErros";
import AdminConfiguracoes from "./pages/AdminConfiguracoes";
import AdminModoDemo from "./pages/AdminModoDemo";
import UsoGeral from "./pages/UsoGeral";
import NotFound from "./pages/NotFound";
import Bloqueado from "./pages/Bloqueado";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-right" richColors />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/bloqueado" element={<Bloqueado />} />

            {/* Operador / Admin tenant */}
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/exportacoes" element={<Exportacoes />} />
              <Route path="/pedido/:id" element={<PedidoDetalhe />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/integracoes" element={<Integracoes />} />
              <Route path="/de-para" element={<DePara />} />
              <Route path="/catalogo-produtos" element={<CatalogoProdutos />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
              <Route path="/equipe" element={<Equipe />} />
            </Route>

            {/* Super admin */}
            <Route
              element={
                <ProtectedRoute requireSuperAdmin>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/tenants" element={<AdminTenants />} />
              <Route path="/admin/tenants/:id" element={<AdminTenantDetalhe />} />
              <Route path="/admin/uso" element={<UsoGeral />} />
              <Route path="/admin/erros" element={<AdminErros />} />
              <Route path="/admin/configuracoes" element={<AdminConfiguracoes />} />
              <Route path="/admin/modo-demo" element={<AdminModoDemo />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
