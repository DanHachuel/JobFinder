/**
 * App shell: sidebar + header + content area (LeadMaster structure).
 * Fetches /api/health once on mount to know the app state (dry-run,
 * connection mode, version) and shares it with pages through context.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import { api } from '../lib/api.js';

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
  ['/config', 'Configurações'],
];

export function useAppState() {
  return useContext(AppStateContext);
}

export default function Layout({ children }) {
  const location = useLocation();
  const [health, setHealth] = useState(null);
  const [linkedin, setLinkedin] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [healthData, linkedinData] = await Promise.all([api.get('/health'), api.get('/linkedin/status')]);
        if (!cancelled) {
          setHealth(healthData);
          setLinkedin(linkedinData);
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
          setLinkedin(null);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const title = PAGE_TITLES.find(([path]) => location.pathname.startsWith(path))?.[1] ?? 'Painel';
  const dryRun = linkedin?.dryRun ?? health?.dryRun ?? true;

  return (
    <AppStateContext.Provider value={{ health, linkedin, refresh: () => window.location.reload() }}>
      <div className="flex min-h-screen bg-gray-100">
        <Sidebar officialApiConfigured={Boolean(linkedin?.channel?.official?.hasAccessToken)} version={health?.version} />
        <main className="flex min-w-0 flex-1 flex-col">
          <Header title={title} dryRun={dryRun} connected={Boolean(linkedin?.connected)} mode={linkedin?.mode} />
          <div key={location.pathname} className="flex-1 overflow-y-auto p-8">
            {children}
            <footer className="mt-8 flex items-center justify-between border-t border-gray-200 pt-4 text-xs text-gray-400">
              <span>© 2026 JobFinder (DanHachuel) · execução 100% local</span>
              <span>Armazenamento em JSON · nenhum dado sai desta máquina</span>
            </footer>
          </div>
        </main>
      </div>
    </AppStateContext.Provider>
  );
}
