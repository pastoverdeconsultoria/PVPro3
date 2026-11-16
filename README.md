# PVPro3

Sistema de gestão de pastagem por lotação ocorrida. Independente do PV Pro, com banco próprio.

Leia primeiro o `CLAUDE.md`: definições de lotação, regras de trabalho, decisões de arquitetura, plano da etapa 1 e pendências.

## Colocar para funcionar

1. **Banco (uma vez cada arquivo, na ordem):** no Supabase, abra **SQL Editor**, cole o conteúdo inteiro de `supabase/migrations/20261115120000_base.sql` e clique em **Run**. Depois faça o mesmo com `supabase/migrations/20261116120000_caderno.sql`. Sem o segundo, o app abre normalmente, só sem caderno e sem chuva, e avisa na tela.
2. **Chaves:** em **Project Settings → API**, copie o **Project URL** e a chave **anon / publishable**. Nunca use a chave `service_role`.
3. **No computador:** copie `.env.example` para `.env.local` e preencha as duas variáveis.
4. **Na Vercel:** em **Settings → Environment Variables**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os mesmos valores e publique de novo (Deployments → Redeploy).
5. **Login:** no Supabase, em **Authentication → URL Configuration**, ponha o endereço da Vercel em **Site URL**, para o link de confirmação de e-mail voltar para o app.

Sem as variáveis, o app abre uma tela dizendo que falta ligar o banco.

## Rodar

```bash
npm install
npm run dev      # desenvolvimento
npm test         # testes (Vitest)
npm run build    # confere tipos e gera dist/ com o service worker
npm run preview  # serve o dist/ para testar instalação e uso offline
```

`npm run dev` com `?demo` no endereço (ex.: `http://localhost:5173/?demo`) abre o app com a fazenda inventada do simulador, em memória, para conferir telas sem banco. Os números são inventados e esse modo não entra no app publicado.

O service worker só existe no build. Para testar instalação e uso sem sinal, use `npm run build` e `npm run preview`.

## Estrutura

- `supabase/migrations/`: o banco. Tabelas, regras de acesso (só membro da fazenda lê e grava, anônimo não vê nada, não existe DELETE) e as gravações que precisam ser uma transação só.
- `src/data/`: acesso aos dados. `supabaseRepo.ts` fala com o Supabase (limite de 8 s, leitura paginada); `memoryRepo.ts` é a versão em memória usada nos testes de tela; `rows.ts` traduz linha do banco para tipo do app; `cache.ts` guarda a cópia local para abrir sem sinal.
- `src/state/`: estado do app (conta, fazenda aberta, gravações). Toda gravação é conferida antes de ir ao servidor.
- `src/lib/lots/`: núcleo do lote, em TypeScript puro. `deriveLot` recalcula cabeças, peso, estadias e onde o lote está a partir do histórico; `planMove` monta saída e entrada de uma mudança; `gmd.ts` é a única conta de GMD do app.
- `src/lib/calc/`: o cálculo de lotação. `supplement.ts` é a regra do suplemento (um arquivo só, para trocar de regra); `occupancy.ts` corta as estadias em trechos, soma UA-dia e monta os períodos de pastejo do piquete; `analysis.ts` dá a lotação no período, por piquete e por mês.
- `src/lib/farm/`: situação de hoje da fazenda (ocupação, descanso, lotação instantânea e global), módulos e abertura de fazenda.
- `src/lib/kml/` e `src/lib/geo.ts`: leitor de KML e KMZ, área em hectares pelo elipsoide WGS84 e centroide.
- `src/lib/notebook/queue.ts`: fila do caderno no aparelho do vaqueiro. Guarda o relato antes de tentar enviar, envia na ordem e não duplica.
- `src/pages/CadernoPublico.tsx`: a página do link `/c/<token>`, sem login. `src/pages/Caderno.tsx`: a caixa de revisão do consultor.
- `src/pages/`: Painel, Mapa, Módulos, Rebanho, Clima e Caderno vão no pacote principal. Análise e a abertura de fazenda por KML são carregadas sob demanda, com limite de 8 s e "tentar de novo".
- `src/components/`: casca, mapa em SVG (sem satélite, abre sem sinal), formulários de campo.
- `reference/`: protótipo original (`simulador/app.html`), testes de fluxo e capturas. Só consulta; não entra no build.

## Testes

- `src/data/db.test.ts` e `src/data/caderno.db.test.ts` rodam as migrações num Postgres de verdade dentro do teste (PGlite), imitando os papéis e as permissões padrão do Supabase, e provam as regras de acesso, inclusive que o anônimo só chama as duas funções do link.
- `src/Caderno.test.tsx` cobre o caderno de ponta a ponta: vaqueiro com e sem sinal, consultor conferindo e lançando, chuva.
- `src/App.test.tsx` usa o app inteiro com o banco em memória: entrar, abrir fazenda por KML, mover lote, pesar, apagar e desfazer, montar módulo.
- A ligação com o Supabase de verdade (`supabaseRepo.ts`) não tem teste automático: só é exercitada com um projeto real.

## Estado

Etapa 1 escrita: login, lista de fazendas, abertura por KML/KMZ, mapa, módulos, lotes com mudança de piquete, pesagem, entrada e saída de animais, histórico com exclusão suave, e painel com a lotação global.

Etapa 2 escrita: caderno da equipe. O consultor manda o link da fazenda; o vaqueiro anota chuva e mudança de gado sem login, e o relato fica guardado no aparelho até haver sinal. O consultor vê o aviso no Painel, confere o que vai ser gravado, corrige, lança ou descarta. A tela de Clima mostra a chuva real registrada.

Etapa 3 escrita, menos a projeção: lotação ocorrida e global do ciclo no cartão do piquete, UA de pasto com o desconto do suplemento, e a tela de Análise com a lotação no período, por mês, por módulo e o ranking dos piquetes.

Fora destas etapas: projeção de capacidade de suporte e dose de N, chuva e temperatura estimadas pelo centroide (etapa 4). No app do consultor, sem sinal ele abre e mostra a última cópia, mas não grava: a fila offline existe só no caderno do vaqueiro.
