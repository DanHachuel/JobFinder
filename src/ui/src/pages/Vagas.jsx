/**
 * Vagas — resume upload + scoring (§5.3.1) and search (§5.3.2).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Search, Save, Trash2, Send, FileText } from 'lucide-react';

import { api, ApiError } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useAppState } from '../components/Layout.jsx';

import { Spinner, EmptyState, MetricCard, ProgressBar } from '../components/Widgets.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { formatPercent, scoreBarColor, scoreTone } from '../lib/format.js';

export default function Vagas() {
  const toast = useToast();
  const { linkedin } = useAppState();
  const fileInput = useRef(null);

  const [resume, setResume] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [saved, setSaved] = useState({ items: [], total: 0, page: 1 });
  const [stats, setStats] = useState(null);
  const [page, setPage] = useState(1);

  const [filters, setFilters] = useState({ title: '', location: '', remote: false });

  const load = useCallback(async () => {
    try {
      const [resumeData, savedData, statsData] = await Promise.all([
        api.get('/resume'),
        api.get('/jobs', { query: { status: 'saved', page, limit: 10 } }),
        api.get('/jobs/stats'),
      ]);
      setResume(resumeData.resume);
      setSaved(savedData);
      setStats(statsData);
    } catch (err) {
      toast.error(`Falha ao carregar: ${err.message}`);
    }
  }, [page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.post(`/resume?fileName=${encodeURIComponent(file.name)}&mimeType=${encodeURIComponent(file.type || '')}`, file, { raw: true, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      setResume(result.resume);
      toast.success(`Currículo processado: ${result.resume.skills.length} skills detectadas.`);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('Falha ao processar o currículo.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const search = async () => {
    if (!filters.title.trim()) {
      toast.error('Informe o cargo desejado.');
      return;
    }
    setSearching(true);
    try {
      const data = await api.post('/jobs/search', filters);
      setResults(data.jobs);
      if (data.simulated) toast.info('Dry-run: vagas simuladas para explorar o match.');
    } catch (err) {
      toast.error(`Busca falhou: ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  const saveJob = async (job, status) => {
    try {
      await api.post('/jobs', { job, status });
      toast.success(status === 'saved' ? 'Vaga salva.' : 'Vaga descartada.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeSaved = async (id) => {
    try {
      await api.del(`/jobs/${id}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const apply = async (job) => {
    try {
      const outcome = await api.post('/applications', { job, dryRun: true });
      toast.success(`Candidatura registrada (${outcome.application.status === 'dry_run' ? 'dry-run' : outcome.application.status}).`);
      load();
    } catch (err) {
      toast.error(`Falha ao candidatar: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <MetricCard label="Currículo" value={resume?.skills?.length ? `${resume.skills.length} skills` : 'Não enviado'} hint={resume?.fileName ?? 'PDF, DOCX ou TXT'} />
        <MetricCard label="Vagas salvas" value={saved.total} hint="match semântico" />
        <MetricCard label="Match médio" value={stats?.averageScore ?? '—'} hint="currículo × vagas salvas" />
        <MetricCard label="Resultados na busca" value={results.length} hint="score semântico 0–100" />
      </div>

      {/* Resume */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="text-base font-semibold text-gray-800">Currículo</h3>
          <p className="mt-1 text-xs text-gray-500">Processamento automático (PDF via pdfjs, DOCX via mammoth).</p>
          <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,application/pdf,text/plain" className="mt-4 hidden" onChange={(event) => upload(event.target.files?.[0])} />
          <button className="btn-primary mt-2" onClick={() => fileInput.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4" />
            {uploading ? 'Processando…' : 'Enviar currículo'}
          </button>

          {resume?.skills?.length > 0 && (
            <div className="mt-4">
              <p className="label">Skills detectadas</p>
              <div className="flex flex-wrap gap-1.5">
                {resume.skills.map((skill) => (
                  <span key={skill} className="badge bg-indigo-50 text-indigo-600">{skill}</span>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-400">
                {resume.titles?.length ? `Títulos: ${resume.titles.join(' · ')}` : ''}
                {resume.yearsExperience ? ` · ${resume.yearsExperience} anos de experiência` : ''}
                {resume.languages?.length ? ` · Idiomas: ${resume.languages.join(', ')}` : ''}
              </p>
            </div>
          )}
          {!resume?.skills?.length && (
            <p className="mt-4 rounded-lg border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
              Envie seu currículo para ver o score de match em cada vaga.
            </p>
          )}
        </div>

        {/* Search */}
        <div className="card">
          <h3 className="text-base font-semibold text-gray-800">Buscar vagas</h3>
          <div className="mt-4 space-y-3">
            <div>
              <label className="label" htmlFor="jobTitle">Cargo / palavras-chave</label>
              <input id="jobTitle" className="input" placeholder="Ex.: Engenheiro de Software" value={filters.title} onChange={(event) => setFilters({ ...filters, title: event.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="jobLocation">Localização</label>
              <input id="jobLocation" className="input" placeholder="Ex.: São Paulo, Remoto" value={filters.location} onChange={(event) => setFilters({ ...filters, location: event.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={filters.remote} onChange={(event) => setFilters({ ...filters, remote: event.target.checked })} />
              Somente remotas
            </label>
          </div>
          <button className="btn-primary mt-4 w-full" onClick={search} disabled={searching}>
            <Search className="h-4 w-4" />
            {searching ? 'Buscando…' : 'Buscar vagas'}
          </button>
          <p className="mt-2 text-xs text-gray-400">Dry-run ativo ({linkedin?.mode ?? 'dry-run'}): use Integrações para conectar e buscar de verdade.</p>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-800">Resultados ({results.length})</h3>
          <ul className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {results.map((job) => (
              <li key={job.jobId} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{job.title}</p>
                    <p className="text-xs text-gray-500">{job.company} · {job.location}{job.easyApply !== null ? (job.easyApply ? ' · Easy Apply' : ' · candidatura externa') : ''}</p>
                  </div>
                  <span className={`text-2xl font-bold ${scoreTone(job.matchScore)}`}>{job.matchScore}</span>
                </div>
                <div className="mt-3">
                  <ProgressBar percent={job.matchScore} tone={scoreBarColor(job.matchScore)} showPercent={false} />
                </div>
                <p className="mt-2 text-xs font-medium text-gray-600">{job.recommendation}</p>
                {job.skillGaps?.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400">
                    Lacunas: {job.skillGaps.join(', ')}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => saveJob(job, 'saved')}>
                    <Save className="h-3.5 w-3.5" />
                    Salvar
                  </button>
                  <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => saveJob(job, 'discarded')}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Descartar
                  </button>
                  <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => apply(job)}>
                    <Send className="h-3.5 w-3.5" />
                    Candidatar-se (dry-run)
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Saved jobs */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Vagas salvas</h3>
        {saved.items.length === 0 ? (
          <EmptyState icon={FileText} title="Nenhuma vaga salva" hint="Busque vagas acima e salve as que fizerem sentido para seu perfil." />
        ) : (
          <ul className="mt-4 space-y-3">
            {saved.items.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-100 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">{job.title}</p>
                  <p className="text-xs text-gray-500">{job.company} · {job.location}</p>
                </div>
                <StatusBadge status={job.status === 'discarded' ? 'discarded' : 'saved'} />
                <span className={`text-lg font-bold ${scoreTone(job.matchScore)}`}>{job.matchScore}</span>
                <div className="flex gap-2">
                  <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => apply(job)}>
                    <Send className="h-3.5 w-3.5" />
                    Candidatar
                  </button>
                  <button className="btn-secondary !px-3 !py-1.5 text-xs !text-red-600" onClick={() => removeSaved(job.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {saved.total > saved.limit && (
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>Página {saved.page} · {saved.total} vagas salvas</span>
            <div className="flex gap-2">
              <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
              <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page * saved.limit >= saved.total} onClick={() => setPage((p) => p + 1)}>Próxima</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
