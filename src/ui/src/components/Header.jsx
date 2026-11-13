/**
 * Header (LeadMaster reference): page title, "Ver tutorial" link,
 * dry-run indicator and user avatar. Page titles come from the route map
 * so every screen stays consistent (Jakob's law).
 */
import React from 'react';
import { PlayCircle, FlaskConical, ShieldCheck, Zap } from 'lucide-react';

import { initialsFrom, useAuth } from '../lib/auth.jsx';

const TUTORIAL_URL = 'https://github.com/DanHachuel/JobFinder#tutorial';

export default function Header({ title, dryRun, connected, mode }) {
  const { user } = useAuth();

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        {dryRun && (
          <span className="badge bg-amber-100 text-amber-800" title="Modo dry-run: nenhuma ação real é enviada ao LinkedIn">
            <FlaskConical className="mr-1 h-3 w-3" />
            dry-run
          </span>
        )}
        {!dryRun && (
          <span
            className="badge bg-red-100 text-red-800"
            title="Modo real: postagens, convites, DMs e candidaturas serão executados de verdade no LinkedIn"
          >
            <Zap className="mr-1 h-3 w-3" />
            Real Mode
          </span>
        )}
        {connected && !dryRun && (
          <span className="badge bg-green-100 text-green-800" title={`Canal do LinkedIn conectado (${mode ?? 'cookie'}) — ações reais serão enviadas`}>
            <ShieldCheck className="mr-1 h-3 w-3" />
            conectado
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <a
          href={TUTORIAL_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          <PlayCircle className="mr-1 inline h-4 w-4" />
          Ver tutorial
        </a>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600"
          title={`${user?.email ?? 'conta local'} — sessão local (jobfinder_session)`}
        >
          {initialsFrom(user?.email)}
        </div>
      </div>
    </header>
  );
}
