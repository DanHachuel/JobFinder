/**
 * App shell: sidebar + header + content area (LeadMaster structure).
 * Fetches /api/health + /api/linkedin/status on mount and on every route
 * change to know the app state (dry-run, connection mode, version) and
 * shares it with pages through context.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const AppStateContext = createContext(null);

const PAGE_TITLES = [
  ['/', 'Painel'],
  ['/postagens/agendar', 'Agendar postagem'],
  ['/postagens', 'Postagens'],
  ['/conexoes/dm', 'Cascatas de DM'],
  ['/conexoes', 'Networking — conexões'],
  ['/vagas/candidaturas', 'Candidaturas'],
  ['/vagas', 'Buscar vagas'],
  ['/integracoes', 'Integrações — LinkedIn'],
  ['/configuracoes', 'Configurações'],
  ['/config', 'Configurações'],
];

export function useAppState() {
  return useContext(AppStateContext);
}

export default function Layout({ children }) {
  const location = useLocation();
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [linkedin, setLinkedin] = useState(null);

  const load = useCallback(async () => {
    try {
      const [healthData, linkedinData] = await Promise.all([api.get('/health'), api.get('/linkedin/status')]);
      setHealth(healthData);
      setLinkedin(linkedinData);
    } catch {
      setHealth(null);
      setLinkedin(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, location.pathname]);

  const title = PAGE_TITLES.find(([path]) => location.pathname.startsWith(path))?.[1] ?? 'Painel';
  const dryRun = linkedin?.dryRun ?? health?.dryRun ?? true;

  return (
    <AppStateContext.Provider value={{ health, linkedin, user, refresh: load }}>
      {/* Dashboard shell: fixed viewport, independent scroll per region */}
      <div className="flex h-screen w-full overflow-hidden overflow-x-hidden bg-gray-100">
        <Sidebar officialApiConfigured={Boolean(linkedin?.channel?.official?.hasAccessToken)} />
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <Header title={title} dryRun={dryRun} connected={Boolean(linkedin?.connected)} mode={linkedin?.mode} />
          <div key={location.pathname} className="flex-1 overflow-y-auto overflow-x-hidden p-8">
            {children}
            <footer className="mt-8 flex items-center justify-between border-t border-gray-200 pt-4 text-xs text-gray-400">
              <span>© 2026 JobFinder (DanHachuel)</span>
              <span>Armazenamento em JSON</span>
            </footer>
          </div>
        </main>
      </div>
    </AppStateContext.Provider>
  );
}
