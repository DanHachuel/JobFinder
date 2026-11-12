/**
 * Integrações — LinkedIn auth (§6.3, §7).
 * Official API (OAuth) + cookie fallback, channels CRUD, risk notice.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plug, KeyRound, Cookie, ShieldAlert, Trash2, Power, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

import { Spinner, EmptyState, Modal, ProgressBar } from '../components/Widgets.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { formatDateTime } from '../lib/format.js';

const LINKEDIN_API_URL = 'https://www.linkedin.com/help/linkedin/answer/a526048/acesso-as-apis-do-linkedin?lang=pt';
const COOKIE_EXTENSION_URL = 'https://chromewebstore.google.com/detail/get-cookieslocally/cclelndahbckbenkjhflpdbgdldlbecc';

export default function Integracoes() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const fileInput = useRef(null);

  const [status, setStatus] = useState(null);
  const [channels, setChannels] = useState([]);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [label, setLabel] = useState('LinkedIn principal');
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [cookiesModal, setCookiesModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [statusData, channelsData] = await Promise.all([api.get('/linkedin/status'), api.get('/channels')]);
      setStatus(statusData);
      setChannels(channelsData.channels);
    } catch (err) {
      toast.error(`Falha ao carregar integrações: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // OAuth result from the redirect (?linkedin=connected|error)
  useEffect(() => {
    const result = searchParams.get('linkedin');
    if (result === 'connected') toast.success('API Oficial conectada com sucesso!');
    if (result === 'error') toast.error(`Falha no OAuth: ${searchParams.get('reason') ?? 'erro desconhecido'}`);
    if (result) window.history.replaceState({}, '', '/integracoes');
  }, [searchParams, toast]);

  const registerOfficial = async () => {
    if (!clientId || !clientSecret) {
      toast.error('Preencha clientId e clientSecret.');
      return;
    }
    try {
      await api.post('/channels/official', { label, clientId, clientSecret });
      toast.success('Credenciais salvas localmente. Agora inicie o OAuth.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const startOAuth = async () => {
    try {
      const data = await api.post('/channels/oauth/start');
      window.open(data.url, '_blank', 'noopener,noreferrer,width=600,height=800');
      toast.info('Complete a autorização no LinkedIn; você voltará para esta tela automaticamente.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await api.post('/linkedin/test');
      if (result.ok) toast.success(`Conexão OK (${result.mode}${result.profile ? `: ${result.profile.name ?? result.profile.firstName ?? ''}` : ''})`);
      else toast.error(result.message);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  };

  const activate = async (id) => {
    try {
      await api.post(`/channels/${id}/activate`);
      toast.success('Canal ativado.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/channels/${id}`);
      toast.info('Canal removido.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const uploadCookies = async (file) => {
    if (!file) return;
    try {
      const result = await api.post(`/channels/cookies?label=${encodeURIComponent(file.name)}`, file, {
        raw: true,
        headers: { 'Content-Type': 'text/plain' },
      });
      if (result.test.ok) {
        toast.success(`Sessão válida! Perfil: ${result.test.profile.firstName ?? ''} ${result.test.profile.lastName ?? ''}`);
      } else {
        toast.error(`Cookies salvos, mas o teste falhou: ${result.test.message}. Verifique se o LinkedIn está acessível desta máquina.`);
      }
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  if (loading) return <Spinner label="Carregando integrações…" />;

  const connected = Boolean(status?.connected);

  return (
    <div className="space-y-6">
      {/* Connection summary */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="card">
          <p className="text-sm font-medium text-gray-500">Status da conexão</p>
          <div className="mt-2 flex items-center gap-2">
            <span className={`badge ${connected ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-amber-500'}`} />
              {connected ? status.mode === 'official' ? 'API Oficial' : 'Cookies de sessão' : 'Dry-run (sem canal)'}
            </span>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            {status?.dryRun
              ? status?.dryRunReason === 'global-dry-run'
                ? 'Canal conectado, mas o dry-run global está ativo em Configurações.'
                : 'Nenhum canal conectado — tudo está sendo simulado.'
              : 'Modo ativo: as ações serão enviadas ao LinkedIn.'}
          </p>
        </div>

        <div className="card">
          <p className="text-sm font-medium text-gray-500">Canais cadastrados</p>
          <p className="mt-2 text-2xl font-bold text-gray-800">{channels.length}</p>
          <p className="mt-1 text-xs text-gray-400">
            {channels.filter((c) => c.authMode === 'official').length} via API oficial · {channels.filter((c) => c.authMode === 'cookie').length} via cookies
          </p>
        </div>

        <div className="card">
          <p className="text-sm font-medium text-gray-500">Testar conexão</p>
          <button className="btn-secondary mt-3 w-full" onClick={testConnection} disabled={testing}>
            <RefreshCw className="h-4 w-4" />
            {testing ? 'Testando…' : 'Testar agora'}
          </button>
          <button className="btn-primary mt-2 w-full" onClick={() => window.open(LINKEDIN_API_URL, '_blank', 'noopener,noreferrer')}>
            <KeyRound className="h-4 w-4" />
            Criar API Oficial do LinkedIn
          </button>
        </div>
      </div>

      {/* Official API */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Método recomendado — API Oficial (OAuth 2.0)</h3>
        <p className="mt-1 text-xs text-gray-500">
          Crie seu app no LinkedIn (botão acima), copie o <strong>Client ID</strong> e o <strong>Client Secret</strong> e registre o redirect
          <code className="mx-1 rounded bg-gray-100 px-1">http://127.0.0.1:4040/api/channels/oauth/callback</code>. As credenciais ficam apenas no arquivo local
          <code className="mx-1 rounded bg-gray-100 px-1">~/.jobfinder/channels.json</code>.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="label" htmlFor="channelLabel">Nome do canal</label>
            <input id="channelLabel" className="input" value={label} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="clientId">Client ID</label>
            <input id="clientId" className="input" placeholder="77xxxxxxx" value={clientId} onChange={(event) => setClientId(event.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="clientSecret">Client Secret</label>
            <input id="clientSecret" type="password" className="input" placeholder="••••••••" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={registerOfficial}>
            <Plug className="h-4 w-4" />
            Salvar credenciais
          </button>
          <button className="btn-secondary" onClick={startOAuth}>
            <KeyRound className="h-4 w-4" />
            Iniciar autorização OAuth
          </button>
        </div>
        {!status?.channel?.official?.hasAccessToken && channels.every((c) => !c.official?.hasAccessToken) && (
          <span className="badge mt-3 bg-amber-100 text-amber-800">⚠ Recomendado</span>
        )}
      </div>

      {/* Cookie fallback */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Fallback — cookies de sessão</h3>
        <p className="mt-1 text-xs text-gray-500">
          Com a extensão <a href={COOKIE_EXTENSION_URL} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:text-indigo-800">"Get cookies.txt LOCALLY"</a>,
          exporte os cookies de <code className="rounded bg-gray-100 px-1">linkedin.com</code> (formato cookies.txt) e envie abaixo. O app usa a API interna
          (Voyager) para convites, DMs e Easy Apply.
        </p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-start gap-2 text-xs text-amber-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Uso por conta e risco:</strong> automação pode violar os Termos de Serviço do LinkedIn e resultar em
              restrições da conta. Os cookies ficam <strong>somente no seu computador</strong> e nunca são compartilhados. Respeite
              os limites de rate configurados.
            </span>
          </p>
        </div>

        <input ref={fileInput} type="file" accept=".txt,text/plain" className="mt-4 hidden" onChange={(event) => uploadCookies(event.target.files?.[0])} />
        <button className="btn-primary" onClick={() => fileInput.current?.click()}>
          <Cookie className="h-4 w-4" />
          Enviar cookies.txt
        </button>
        <button className="btn-secondary ml-2" onClick={() => setCookiesModal(true)}>Como exportar?</button>
      </div>

      {/* Channels */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Canais conectados</h3>
        {channels.length === 0 ? (
          <EmptyState icon={Plug} title="Nenhum canal cadastrado" hint="Use a API Oficial (recomendado) ou envie os cookies de sessão." />
        ) : (
          <ul className="mt-4 divide-y divide-gray-50">
            {channels.map((channel) => (
              <li key={channel.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">
                    {channel.label} <span className="ml-1 text-xs text-gray-400">{channel.authMode === 'official' ? 'API Oficial' : 'cookies'}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {channel.official?.hasAccessToken ? `token válido${channel.official.expiresAt ? ` até ${formatDateTime(channel.official.expiresAt)}` : ''}` : ''}
                    {channel.cookiesCount ? `${channel.cookiesCount} cookies (${channel.cookieNames?.slice(0, 3).join(', ')}…)` : ''}
                    {channel.lastError ? ` · último erro: ${channel.lastError}` : ''}
                  </p>
                </div>
                <StatusBadge status={channel.status === 'active' ? 'active' : channel.status} />
                {channel.status !== 'active' && (
                  <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => activate(channel.id)} title="Tornar ativo">
                    <Power className="h-3.5 w-3.5" />
                  </button>
                )}
                <button className="btn-secondary !px-3 !py-1.5 text-xs !text-red-600" onClick={() => remove(channel.id)} title="Remover">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Suporte */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Suporte</h3>
        <div className="mt-4 space-y-3 text-xs text-gray-500">
          <ProgressBar label="Diagnóstico do ambiente" percent={100} showPercent={false} tone="bg-green-500" />
          <p>Servidor resposta OK · dados em <code className="rounded bg-gray-100 px-1">~/.jobfinder/</code> · versão 0.0.01</p>
          <p>
            Dúvidas e issues: <a href="https://github.com/DanHachuel/JobFinder/issues" target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:text-indigo-800">github.com/DanHachuel/JobFinder/issues</a>
            {' · '}
            <a href="https://github.com/DanHachuel/JobFinder#tutorial" target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:text-indigo-800">tutorial completo</a>
          </p>
        </div>
      </div>

      <Modal open={cookiesModal} title="Como exportar os cookies" onClose={() => setCookiesModal(false)}>
        <ol className="list-decimal space-y-2 pl-5 text-xs text-gray-600">
          <li>Instale a extensão "Get cookies.txt LOCALLY" no Chrome/Edge.</li>
          <li>Acesse <strong>linkedin.com</strong> logado na sua conta.</li>
          <li>Clique no ícone da extensão e escolha <strong>Export</strong> (formato cookies.txt).</li>
          <li>Volte aqui e envie o arquivo. O app valida <code>li_at</code> e <code>JSESSIONID</code> automaticamente.</li>
        </ol>
        <p className="mt-4 text-xs text-gray-500">A sessão expira quando o LinkedIn invalida os cookies — reexporte se os testes começarem a falhar.</p>
      </Modal>
    </div>
  );
}
