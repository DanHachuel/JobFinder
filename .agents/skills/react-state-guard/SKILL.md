---
name: react-state-guard
description: Mantém o estado do React previsível, sincronizado com o backend e imune a memory leaks em polling de background workers.
---

# React State Guard

## Propósito

A UI é um espelho do estado que vive no backend (`~/.jobfinder/*.json`). Estado duplicado
no React envelhece, some no F5 e cria inconsistência entre tela e realidade. Com a Fase 2
(background worker) chegando, polling mal feito vira memory leak e loop de renderização.

## Quando aplicar

Ao criar/alterar qualquer componente em `src/ui/src/` — sobretudo os que leem estado do
servidor (Dashboard, Postagens, Conexoes, Vagas, Candidaturas, Configuracoes).

## Regras

1. **Backend é a fonte da verdade.** Tarefa em andamento (fila de posts, cascata de DM,
   candidatura) deve ser **lida da API**, nunca mantida só no `useState`. Assim sobrevive a
   F5, Troca de aba e reconexão.
2. **Sessão via contexto, não via `useState` solto.** `useAuth()` (`src/ui/src/lib/auth.jsx`)
   é a única fonte de "quem está logado"; qualquer `401` dispara `jobfinder:unauthorized` e
   derruba a sessão. Não recrie esse mecanismo.
3. **Estado do app via contexto.** `useAppState()` (`components/Layout.jsx`) carrega
   `/api/health` + `/api/linkedin/status`. Use o `refresh` dele depois de mutar config —
   não chame `window.location.reload()`.
4. **Nada de `setInterval` solto.** Para polling (Fase 2): `useEffect` + `setTimeout`
   recursivo **com `AbortController`** e limpeza no `return` do efeito. Nunca `setInterval`
   infinito sem limpar.
5. **Sem loop de renderização.** Não atualize estado dentro de `useEffect` que depende desse
   mesmo estado sem condição de parada. Dependência de efeito = valores usados por ele.
6. **Requisições canceláveis.** Toda busca em efeito deve ser abortada no cleanup
   (`AbortController` / flag `cancelled`), senão resposta tardia escreve em componente
   desmontado.
7. **Formulário controlado + validação no cliente antes do envio** (mínimo de caracteres,
   confirmação de senha), mas **o backend sempre revalida**.
8. **Feedback imediato.** Ação do usuário → `setSaving(true)`, `toast` de sucesso/erro e
   `finally` restaurando o estado. Nunca deixar botão "pendurado" em carregando.

## Padrão aprovado no repositório

```jsx
// carga de estado do servidor (Layout.jsx)
const load = useCallback(async () => {
  const [healthData, linkedinData] = await Promise.all([api.get('/health'), api.get('/linkedin/status')]);
  setHealth(healthData);
  setLinkedin(linkedinData);
}, []);

useEffect(() => { load(); }, [load, location.pathname]);
```

```jsx
// mutação + refresh do estado global (Config.jsx)
const persistDryRun = async (dryRun) => {
  setSavingDryRun(true);
  try {
    const result = await api.put('/config', { dryRun });
    setConfig(result.config);
    toast.success(dryRun ? 'Dry-run reativado…' : 'Modo real ativado…');
    refresh?.();                 // estado global, não reload da página
  } catch (err) {
    toast.error(err.message);
  } finally {
    setSavingDryRun(false);
  }
};
```

## Padrão para polling da Fase 2 (ainda não implementado)

```jsx
useEffect(() => {
  const controller = new AbortController();
  let timer;
  const poll = async () => {
    try {
      const data = await api.get('/workers/status', { signal: controller.signal });
      setStatus(data);
    } catch { /* abortado ou offline */ }
    timer = setTimeout(poll, 5000);
  };
  poll();
  return () => { controller.abort(); clearTimeout(timer); };
}, []);
```

## Anti-padrões proibidos

```jsx
// ❌ intervalo sem limpeza
useEffect(() => { setInterval(() => tick(), 1000); }, []);

// ❌ estado local como fonte da verdade de tarefa do backend
const [queue, setQueue] = useState([]);   // sem nunca ler GET /api/posts

// ❌ reload completo para "atualizar" a tela
refresh: () => window.location.reload()

// ❌ efeito que escreve no próprio estado sem parada
useEffect(() => { setCount(count + 1); }, [count]);
```

## Checklist

- [ ] Estado de trabalho vem da API (sobrevive a F5).
- [ ] Sessão e estado global via `useAuth`/`useAppState`.
- [ ] Nenhum `setInterval` sem limpeza; abort em requisições de efeito.
- [ ] Nenhum efeito atualiza o próprio estado sem condição de parada.
- [ ] Ações do usuário têm estado de carregando + toast + `finally`.