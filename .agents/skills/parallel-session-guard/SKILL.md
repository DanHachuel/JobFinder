---
name: parallel-session-guard
description: Evita que duas sessões de agente (ou uma sessão e um humano) sobrescrevam o trabalho uma da outra no mesmo repositório.
---

# Parallel Session Guard

## Propósito

Duas escritas concorrentes no mesmo working tree produzem trabalho perdido, commits
misturados e releases quebradas. No JobFinder isso já aconteceu: uma release `0.1.03`
(badge de versão) e um bloco de "resiliência de processo" apareceram no meio de uma
implementação de auth, e o working tree passou a conter alterações de autoria desconhecida.

## Quando aplicar

No **início** de toda tarefa, antes do primeiro `git add`, e antes de cada `git push`.

## Regras

1. **Proibição de sessões paralelas.** Nunca rodar dois agentes no mesmo repositório ao
   mesmo tempo. Se você suspeitar que existe outra sessão ativa, **pare** e reporte — não
   "resolva" na marra.
2. **Snapshot antes.** No início da tarefa registre o estado:
   ```bash
   git status --short
   git log --oneline -3
   ```
3. **Verificação pré-commit.** Antes de cada commit:
   ```bash
   git status --short
   git diff --stat
   ```
   Se existirem arquivos modificados que **não** pertencem à sua tarefa:
   - **PARE.** Não commite, não descarte (`checkout`/`reset`), não faça stash do trabalho
     alheio.
   - Reporte ao usuário com o resultado de `git diff --stat` e pergunte como proceder
     (incluir no commit / commitar só o seu / esperar ele commitar).
4. **Rebase obrigatório antes do push.**
   ```bash
   git fetch origin
   git rebase origin/main      # ou: git pull --rebase origin main
   git push origin main
   ```
   Nunca `git push --force` em `main`.
5. **Commit atômico por tarefa.** Uma tarefa = um commit coeso. Não acumule duas features no
   mesmo commit para "não perder" o trabalho da outra sessão.
6. **Tags são do fluxo de release.** A criação/`push` de tags (`v0.1.0X`) segue a esteira do
   workflow (ver `README.md` → Publishing). Não crie tags soltas no meio de uma tarefa.

## Checklist

- [ ] `git status` no início e antes do commit.
- [ ] Nenhum arquivo de outra autoria foi commitado sem autorização.
- [ ] `git fetch origin` + `rebase` antes do push.
- [ ] Nenhum `--force` em `main`.
- [ ] working tree limpo ao final da tarefa.

## Como reportar (modelo)

```
Detectei alterações de outra sessão no working tree:
  M scripts/cli.mjs      (+53/-12) — handlers de EPIPE/unhandledRejection
  M src/server/index.mjs (+93/-8)  — mesma frente
Elas estão mescladas no arquivo que preciso editar. Como quer proceder?
1) Incluir tudo no meu commit  2) Commitar só a minha parte  3) Esperar você commitar
```