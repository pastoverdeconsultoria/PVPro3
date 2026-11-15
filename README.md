# Lotação (nome provisório)

Sistema de gestão de pastagem por lotação ocorrida. Independente do PV Pro.

Leia primeiro o `CLAUDE.md`: definições de lotação, regras de trabalho, decisões de arquitetura, plano da etapa 1 e pendências.

## Rodar

```bash
npm install
npm run dev      # desenvolvimento
npm test         # testes (Vitest)
npm run build    # confere tipos e gera dist/ com o service worker
npm run preview  # serve o dist/ para testar instalação e uso offline
```

O service worker só existe no build. Para testar instalação e uso sem sinal, use `npm run build` e `npm run preview`.

## Estrutura

- `src/components/Shell.tsx`: cabeçalho, navegação (embaixo no celular, no topo no desktop) e indicador de sinal.
- `src/pages/`: as cinco áreas. Painel, Mapa, Rebanho e Clima vão no pacote principal; Análise é carregada sob demanda.
- `src/lib/lazyScreen.tsx`: tela sob demanda com limite de 8 s e "tentar de novo".
- `src/lib/lots/`: núcleo do lote, em TypeScript puro. `deriveLot` recalcula cabeças, peso, estadias e onde o lote está a partir do histórico; `planMove` monta saída e entrada de uma mudança de piquete; `planRemoval` apaga de forma suave. Ainda sem tela e sem banco.
- `tailwind.config.js`: paleta e fontes do simulador.
- `reference/`: protótipo original (`simulador/app.html`), testes de fluxo e capturas. Só consulta; não entra no build.

## Estado

Etapa 1, entrega 1 (esqueleto do PWA). Ainda sem banco, sem login e sem dados: as telas mostram estado vazio.
