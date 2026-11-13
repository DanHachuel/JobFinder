/**
 * Sidebar (LeadMaster reference): dark #1e1b4b, grouped navigation,
 * collapsible subgroups (Hick's law), version badge next to the logo
 * (injected at build time from the root package.json via Vite define)
 * and the persistent "Criar API Oficial do LinkedIn" button.
 */
import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  PenLine,
  CalendarPlus,
  Plug,
  Settings,
  HelpCircle,
  ExternalLink,
  ChevronDown,
  KeyRound,
  LogOut,
} from 'lucide-react';

import { initialsFrom, useAuth } from '../lib/auth.jsx';

const LINKEDIN_API_URL =
  'https://www.linkedin.com/help/linkedin/answer/a526048/acesso-as-apis-do-linkedin?lang=pt';

/** npm canonical form of the visual version: 0.1.03 -> 0.1.3 */
function canonicalVersion(visual) {
  return String(visual ?? '')
    .split('.')
    .map((part) => String(Number(part)))
    .join('.');
}

function SectionLabel({ children }) {
  return <li className="sidebar-section">{children}</li>;
}

function Item({ to, icon: Icon, children, end }) {
  return (
    <li>
      <NavLink to={to} end={end} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
        {Icon && <Icon className="mr-3 h-4 w-4 shrink-0" />}
        <span>{children}</span>
      </NavLink>
    </li>
  );
}

function Group({ icon: Icon, label, children }) {
  const location = useLocation();
  const isChildActive = children.some((child) => child.props.to === location.pathname);
  const [open, setOpen] = useState(isChildActive);
  return (
    <li>
      <button
        onClick={() => setOpen((value) => !value)}
        className="sidebar-link w-full text-left"
        aria-expanded={open}
      >
        {Icon && <Icon className="mr-3 h-4 w-4 shrink-0" />}
        <span>{label}</span>
        <ChevronDown className={`ml-auto h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <ul className="mt-1 space-y-1 pb-1">{children}</ul>}
    </li>
  );
}

function SubItem({ to, children }) {
  return (
    <li>
      <NavLink to={to} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''} !pl-12`}>
        <span>{children}</span>
      </NavLink>
    </li>
  );
}

export default function Sidebar({ officialApiConfigured }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-[#1e1b4b] text-white">
      {/* Logo + version badge (version injected at build time from the root package.json) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Job<span className="text-[#818cf8]">Finder</span>
        </h1>
        <span
          className="rounded border border-indigo-400/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300"
          title={`Versao ${__APP_VERSION__} (npm: ${canonicalVersion(__APP_VERSION__)})`}
        >
          v{__APP_VERSION__}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1">
          <Item to="/" icon={LayoutDashboard} end>
            Painel
          </Item>

          <SectionLabel>Conexões</SectionLabel>
          <Group icon={Users} label="Conexões">
            <SubItem to="/conexoes">Networking</SubItem>
            <SubItem to="/conexoes/dm">Cascatas de DM</SubItem>
          </Group>

          <SectionLabel>Vagas</SectionLabel>
          <Group icon={Briefcase} label="Vagas">
            <SubItem to="/vagas">Buscar vagas</SubItem>
            <SubItem to="/vagas/candidaturas">Candidaturas</SubItem>
          </Group>

          <SectionLabel>Postagens</SectionLabel>
          <Item to="/postagens" icon={PenLine}>
            Postagens
          </Item>
          <Item to="/postagens/agendar" icon={CalendarPlus}>
            Agendar
          </Item>

          <SectionLabel>Integrações</SectionLabel>
          <Item to="/integracoes" icon={Plug}>
            LinkedIn
          </Item>
          <li>
            <a
              href={LINKEDIN_API_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="sidebar-link"
              title="A API oficial é o método recomendado. Se indisponível, o app usa cookies de sessão como fallback."
            >
              <KeyRound className="mr-3 h-4 w-4 shrink-0 text-[#818cf8]" />
              <span className="flex-1">Criar API Oficial do LinkedIn</span>
              <ExternalLink className="h-3 w-3 text-gray-400" />
            </a>
            {!officialApiConfigured && (
              <span className="ml-6 mt-1 inline-block rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                ⚠ Recomendado
              </span>
            )}
          </li>
          <Item to="/configuracoes" icon={Settings}>
            Configurações
          </Item>

          <SectionLabel>Suporte</SectionLabel>
          <Item to="/integracoes?tab=suporte" icon={HelpCircle}>
            Suporte
          </Item>
        </ul>
      </nav>

      {/* Footer: local account + logout (session lives in an HTTP-only cookie) */}
      <div className="mt-auto border-t border-white/10 p-4">
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-200">
            {initialsFrom(user?.email)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{user?.name ?? 'Conta local'}</p>
            <p className="truncate text-[10px] text-gray-400">{user?.email ?? '—'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a
            href="https://github.com/DanHachuel/JobFinder"
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-2.5 text-xs text-gray-300 transition hover:bg-white/10"
          >
            100% local
          </a>
          <button
            type="button"
            onClick={signOut}
            className="flex items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-2.5 text-xs text-gray-300 transition hover:bg-red-500/20 hover:text-red-200"
            title="Encerrar a sessão local"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair
          </button>
        </div>
      </div>
    </aside>
  );
}
