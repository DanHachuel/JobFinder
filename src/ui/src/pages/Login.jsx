/**
 * Login (referência visual: tela de login do ProdMaker, adaptada para a
 * identidade JobFinder — sidebar #1e1b4b, acento indigo #818cf8).
 *
 * Split screen: painel de marca à esquerda (orbs + partículas, passos do
 * fluxo) e formulário à direita. Autenticação contra
 * ~/.jobfinder/auth.json (senha com hash scrypt no backend).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  PenLine,
  Sparkles,
} from 'lucide-react';

import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const STEPS = [
  { icon: PenLine, title: 'Publique com LLM' },
  { icon: FileText, title: 'Conecte-se' },
  { icon: MessageSquare, title: 'DMs em cascata' },
  { icon: Briefcase, title: 'Candidate-se' },
];

const PARTICLES = [
  { left: '8%', size: 4, color: '#818cf8', duration: 10, delay: 0 },
  { left: '22%', size: 3, color: '#818cf8', duration: 11, delay: 1 },
  { left: '38%', size: 5, color: '#a5b4fc', duration: 12, delay: 1 },
  { left: '55%', size: 3, color: '#818cf8', duration: 11, delay: 1.8 },
  { left: '70%', size: 4, color: '#f472b6', duration: 14, delay: 0.5 },
  { left: '82%', size: 3, color: '#a5b4fc', duration: 12, delay: 1.8 },
  { left: '93%', size: 4, color: '#6366f1', duration: 10, delay: 3.8 },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState(null);

  const loadHint = useCallback(async () => {
    try {
      const data = await api.get('/auth/defaults');
      setHint(data.firstRun ? data : null);
    } catch {
      setHint(null);
    }
  }, []);

  useEffect(() => {
    loadHint();
  }, [loadHint]);

  const from = location.state?.from ?? '/';

  if (user) return <Navigate to={from} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Não foi possível entrar. Verifique o e-mail e a senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Brand panel (dark, ambient orbs + particles) */}
      <div className="relative hidden w-1/2 overflow-hidden bg-[#1e1b4b] lg:flex">
        <div className="login-orb login-orb-a" />
        <div className="login-orb login-orb-b" />
        <div className="login-orb login-orb-center" />
        {PARTICLES.map((particle) => (
          <span
            key={particle.left}
            className="login-particle"
            style={{
              left: particle.left,
              width: particle.size,
              height: particle.size,
              background: particle.color,
              animationDuration: `${particle.duration}s`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}

        <div className="relative z-10 flex h-full w-full flex-col justify-center px-16">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Job<span className="text-[#818cf8]">Finder</span>
          </h1>

          <h2 className="mt-10 max-w-xl text-4xl font-bold leading-tight text-white">
            Tudo o que você precisa para <span className="text-[#818cf8]">automatizar sua carreira</span> no LinkedIn em
            um só lugar
          </h2>
          <p className="mt-4 max-w-md text-lg text-white/50">
            Menos trabalho manual, mais candidaturas certas — em um só lugar.
          </p>

          <div className="mt-12 grid max-w-2xl grid-cols-4 gap-6">
            {STEPS.map((step, index) => (
              <div key={step.title} className="login-step flex flex-col items-center gap-3" style={{ animationDelay: `${0.3 + index * 0.15}s` }}>
                <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl border border-indigo-400/20 bg-indigo-500/10 backdrop-blur-md transition hover:border-indigo-400/50">
                  <span className="absolute left-3 top-2 text-[10px] font-semibold text-indigo-400/60">{index + 1}</span>
                  <step.icon className="h-9 w-9 text-[#a5b4fc]" />
                  {index < STEPS.length - 1 && <span className="login-step-arrow" />}
                </div>
                <h3 className="text-center text-sm font-medium text-white/65">{step.title}</h3>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col justify-between overflow-y-auto bg-gray-50 p-8 lg:w-1/2">
        <div className="flex justify-end">
          <span className="badge bg-indigo-100 text-indigo-700" title="JobFinder — automação inteligente para LinkedIn">
            <Sparkles className="mr-1 h-3 w-3" />
            automação inteligente
          </span>
        </div>

        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-2xl font-bold text-gray-800">Bem-vindo de volta!</h2>
          <p className="mt-2 text-sm text-gray-500">Acesso ao JobFinder — informe seu e-mail e senha.</p>

          {error && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}

          <form className="mt-6 space-y-5" onSubmit={submit}>
            <div>
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="input !pl-10"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">
                Senha
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  className="input !pl-10 !pr-11"
                  placeholder="••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button className="btn-primary w-full" type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>

          {hint && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <p className="font-semibold">Primeiro acesso (usuário pré-criado)</p>
              <p className="mt-1">
                E-mail <code className="font-mono font-semibold">{hint.email}</code> · senha{' '}
                <code className="font-mono font-semibold">123456</code>
              </p>
              <p className="mt-1 text-amber-700">Troque a senha em Configurações → Segurança após o primeiro login.</p>
            </div>
          )}
        </div>

        <div className="mt-8 text-center text-xs text-gray-400">
          <div className="flex items-center justify-center gap-2">
            <a className="hover:text-indigo-600" href="/legal/terms.html" target="_blank" rel="noreferrer noopener">
              Termos de Uso
            </a>
            <span className="opacity-50">|</span>
            <a className="hover:text-indigo-600" href="/legal/privacy.html" target="_blank" rel="noreferrer noopener">
              Política de Privacidade
            </a>
          </div>
          <div className="mt-2">© 2026 JobFinder (DanHachuel) · dados em `~/.jobfinder/`</div>
        </div>
      </div>
    </div>
  );
}
