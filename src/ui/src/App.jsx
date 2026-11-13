import React from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Postagens from './pages/Postagens.jsx';
import Agendar from './pages/Agendar.jsx';
import Conexoes from './pages/Conexoes.jsx';
import DmCascades from './pages/DmCascades.jsx';
import Vagas from './pages/Vagas.jsx';
import Candidaturas from './pages/Candidaturas.jsx';
import Integracoes from './pages/Integracoes.jsx';
import ConfigPage from './pages/Config.jsx';
import LoginPage from './pages/Login.jsx';
import { useAuth } from './lib/auth.jsx';

/** Full-screen splash used while the session is being resolved. */
function SessionSplash() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#1e1b4b] text-indigo-200">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      <span className="text-sm">Verificando sessão…</span>
    </div>
  );
}

/** Every app screen requires an active local session. */
function ProtectedLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <SessionSplash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/postagens" element={<Postagens />} />
        <Route path="/postagens/agendar" element={<Agendar />} />
        <Route path="/conexoes" element={<Conexoes />} />
        <Route path="/conexoes/dm" element={<DmCascades />} />
        <Route path="/vagas" element={<Vagas />} />
        <Route path="/vagas/candidaturas" element={<Candidaturas />} />
        <Route path="/integracoes" element={<Integracoes />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/configuracoes" element={<ConfigPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
