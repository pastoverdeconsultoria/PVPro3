# Sistema de gestão de pastagem por lotação ocorrida — guia para Claude Code

Nome do sistema: **PVPro3** (definido pelo Lucas em 15 nov 2026). Repositório `pastoverdeconsultoria/PVPro3`, projeto Supabase e projeto Vercel com o mesmo nome. Apesar do nome, continua sendo um sistema independente do PV Pro, com banco próprio.

## O que é

Sistema de gestão de pastagem de bovinos de corte, pensado do zero e **independente do PV Pro**. Dono: Lucas Teixeira, agrônomo, Pasto Verde Consultoria (Bahia). Comunicar em português brasileiro, direto, sem rodeio. Ele quer crítica honesta: se algo não se sustenta, dizer.

A ideia central é a **lotação ocorrida**: o que realmente aconteceu em cada piquete, calculado a partir das movimentações de gado registradas, e não de estimativa de oferta. Não depende de medição de altura (a maioria das fazendas ainda não mede). Se o medidor viabilizar altura, entra depois como camada extra.

Esta pasta nasceu de um protótipo em HTML (`reference/simulador/app.html`) que o Lucas avaliou e aprovou como conceito. O simulador usa **dados inventados** (fazenda exemplo, clima sintético). Nada nele foi validado com fazenda real. Tratar os números como hipótese.

## Regras de trabalho

- **Decisão pendente do Lucas:** no PV Pro ele só autoriza mudança de código com a frase exata "Atualizar código ok". Ele não disse se vale aqui. Perguntar antes de assumir. Até lá, planejamento livre e código só sob pedido explícito.
- Investigar e testar antes de implementar. Nunca entregar sem ter rodado.
- Implementação completa depois do ok, nunca parcial.
- Não afirmar que fez algo sem ter feito.
- **Dashboard bonito e bem montado é inegociável.** Paleta escura com verde-limão (ver Design).
- **Celular Android primeiro.** Toda tela cabe em ~360 px. Uso em campo, muitas vezes sem sinal: ação de campo funciona offline.
- Nunca fazer um "apagar tudo" sem confirmação; apagar registro é suave (`deleted_at`) e reversível.

## Definições de lotação (do Lucas, não alterar sem perguntar)

Unidade: **UA = cabeças × peso médio (kg) ÷ 450**. Lotação em **UA/ha**, nunca em kg de MS na tela.

| Indicador | Definição |
|---|---|
| **Instantânea** | UA presentes agora no piquete ÷ área. Mostra também dias de uso. Só existe com gado dentro. |
| **Ocorrida** | UA médias que ocorreram **durante o período de pastejo** ÷ área. Fixa depois que o gado sai. **Não muda com o descanso.** |
| **Global do ciclo** | UA-dia do pastejo ÷ área ÷ (dias de pastejo + dias de descanso). É aqui que o descanso entra. |
| **Global da fazenda** | UA totais ÷ área útil. |
| **Anual** | UA-dia no período ÷ área ÷ dias do período. Vive em outro ambiente (aba Análise), não no cartão do piquete. |

Ao tocar no piquete (mapa) mostrar só: ocupado ou não e as últimas informações. O acumulado do ano **não** vai no cartão.

Estadia contínua do mesmo lote no mesmo piquete é um período de pastejo só (função `lastOcc` agrupa estadias coladas). A UA média ponderada por dia dá a ocorrida (`o.ud / área / dias`).

Pergunta subjetiva na saída do piquete (rapado, no ponto, sobrou): **fora por agora**, upgrade futuro.

## Modelo de dados: log de eventos, estado derivado

Princípio central, herdado do que o simulador acertou e do que o PV Pro errou várias vezes:

- Cada **lote** tem um log de eventos com data própria (pode ser retroativa): `inicio` (cabeças, peso, categoria), `entrada`/`transf_in`, `saida`/`transf_out` (com motivo, ex. venda, morte), `peso`, `cat`, `supl`.
- Cada **estadia** liga lote a piquete: `{lot, pad, start, end|null}`.
- **No banco do app real os nomes mudam** (aprovado em 15 nov 2026). Os nomes acima são os do simulador, onde `entrada`/`saida` significam animais entrando e saindo do lote. Para não confundir com o lote entrando e saindo do piquete, os tipos de evento são: `inicio`, `animais_entrada`, `animais_saida`, `transf_in`, `transf_out`, `pesagem`, `categoria`, `suplemento`, `piquete_entrada`, `piquete_saida`. A estadia deixa de ser gravada e passa a ser derivada dos eventos de piquete.
- **Tudo que a tela mostra é derivado do log** (`derive(f)`): cabeças, peso, categoria, suplemento, e os "eventos de lotação" por trecho de estadia, cortados a cada mudança de estado do lote. Nunca confiar em campo-cache como fonte (peso, cabeças ou `current_paddock` do lote).
- Alterar ou apagar um registro antigo recalcula tudo. Toda mutação passa por `mutate(f, fn)`: tira snapshot, aplica, deriva, valida e **desfaz sozinha** se der erro.
- `validate`: lote não pode ficar com cabeças negativas; não pode haver registro antes da formação do lote.
- `closeZero`: se o lote zera de cabeças, a estadia aberta fecha no dia em que zerou (ou some, se zerou no dia da entrada).
- Peso médio ponderado ao entrar animais: `(h·w + n·kg) / (h + n)`. Pesagem sobrescreve o peso do lote naquele dia.
- Dois registros no mesmo dia desempatam por `seq` crescente.

### Invariantes que o PV Pro pagou para descobrir (nascem prontos aqui)

1. Onde o lote está é **deduzido do histórico** na leitura e na gravação, nunca de um campo gravado.
2. Mover lote grava saída e entrada **numa transação só, com `seq` crescente** (saída antes da entrada). Os eventos são ordenados por `data, seq`, com data pura (sem horário) e `seq` dado pelo servidor. Isto substitui a regra do PV Pro de separar por 1 segundo, aprovado pelo Lucas em 15 nov 2026. O motivo é o mesmo: mesmo instante sem desempate determinístico torna a ordem arbitrária.
3. Entrada com data retroativa não pode passar na frente de uma saída posterior. Reafirmar entrada num piquete onde o lote já está grava só a entrada, nunca saída+entrada no mesmo piquete (partiria a estadia e contaria o gado duas vezes).
4. Apagar a última pesagem devolve o lote ao peso da anterior; se não sobrou pesagem, mantém o peso do cadastro.
5. O GMD do lote é **uma conta só**, num módulo só, lida por todas as telas. Compara os dois últimos **dias** com pesagem, valendo a mais recente do dia. Duas pesagens no mesmo dia dão GMD nulo na lista, nunca divisão por zero. GMD é feature essencial e inegociável.
6. O PostgREST corta em **1000 linhas** sem avisar. Paginar com ordenação estável por `data, id`.
7. Piquete não pode ficar ocupado por lote que não existe mais.
8. Apagar é suave (`deleted_at`).
9. Lote sem nenhuma movimentação, lote com piquete mas sem entrada, e lote cuja última movimentação foi saída são três situações diferentes e a tela diz qual é.

## Suplementação (regra decidida, ainda com ponto aberto)

- Registro por **% do PV por dia** (ex. 1% de suplemento), com data, no log do lote.
- Consumo total do animal: **2,5% do PV** (`INTAKE`), igual para todas as categorias por enquanto.
- Efeito substitutivo: só conta o suplemento acima de **0,3% do PV** (`LIMIAR`), valor único para o ano todo, sem separar seca e águas. O Lucas rejeitou 0,1% por ser irrisório.
- `cutF(sp) = max(0, min(sp, 2,5) − 0,3) / 2,5` é a fração de capim substituída. `pastoF = 1 − cutF`.
- UA de pasto = UA × pastoF. A lotação de pasto ocorrida usa UA de pasto (`uap`).
- **Na tela não mostrar o percentual de redução de capim.** O Lucas achou confuso ("28% de capim"). Mostrar kg/cab/dia de suplemento e UA de pasto.
- **Ponto aberto:** a regra original dele era "1% de suplemento diminui 40% do consumo de capim". Com limiar de 0,3% o simulador dá cerca de 28% a 1% do PV. A diferença entre 28% e 40% não foi decidida. Perguntar antes de mexer.

## Clima

- Dados pelo **centroide** da fazenda, como no PV Pro: Open-Meteo (ERA5) para histórico de Tmax, Tmin e chuva. Não depende de pluviômetro para o histórico.
- **Chuva real** registrada (pluviômetro ou vaqueiro) tem prioridade sobre a estimada do dia. Gráfico com os dois, marcando qual é qual.
- No simulador o clima é **sintético e determinístico** (`rnd` com seed, normais de Itapetinga). Substituir pela API real.
- ETo por Hargreaves-Samani (precisa de latitude e Tmax/Tmin). Balanço hídrico diário simples com CAD de 75 mm e Kc mensal (0,6 de mai a jul; 1,2 em nov e de dez a fev; 0,9 nos demais; hemisfério sul).

## Projeção de capacidade de suporte

Equação pedida pelo Lucas (Tonato, Barioni e Pedreira, Embrapa; N de Martha Jr.), a partir de imagens que ele enviou:

```
P  = M × PPR × FH + N × RN        (kg MS/ha/dia)
PPR = (T − Tb) / (Tótima − Tb), limitado em 1 quando T ≥ Tótima
FH  = 1 se ETR/ETM ≥ 0,5; senão 2 × ETR/ETM
Tótima = 30 °C   Tb = 15,5 °C (decumbens, humidícola) | 16,5 °C (demais)
RN  = 26 kg MS por kg de N
capacidade (UA/ha) = P × eficiência / 11,25     (11,25 = 450 kg × 2,5%)
eficiência de pastejo = 50%
```

- **M de referência:** 40 (extensivo) e 105 (adubado). Vem da prática do Lucas e da tabela que ele enviou (extensivas 30–80; adubadas 100–180; 1º ano após cultivo adubado 150–250).
- **M calibrado** no histórico por mínimos quadrados, com memória por suavização exponencial (peso `w` escolhido por menor SSE entre 1 e 0,2). Só calibra com 6 ou mais meses de observação. Mostrar o erro médio. Opção de alternar entre M calibrado e M de referência.
- Cenários de chuva seco (75%), normal e chuvoso (125%). Hoje são **multiplicadores simulados**; trocar por quantis de chuva histórica real quando houver ERA5.
- **Conta inversa de N:** dada a meta de UA/ha, `need = meta × 11,25 / eficiência`; déficit = need − P; `kg N/ha = déficit × dias / (RN × FH)`. Sem dose quando FH < 0,5 (sem água, adubo não responde; a tela diz isso). Aviso de teto físico quando a meta passa de M_teto = 250.
- N aplicado (registro de adubação, com data) tem efeito distribuído em 60 dias.
- Alerta no painel quando a lotação atual passa 5% da capacidade projetada do mês.

**Não validado:** M calibrado, eficiência de 50%, CAD de 75 mm, consumo de 2,5% igual para todas as categorias. O simulador calibrou com 10–18% de erro **em dados que ele mesmo gerou**, o que não prova nada sobre fazenda real. Não vender a projeção como validada até testar.

Atenção: o PV Pro tem outra implementação de Martha Jr. (`PPR = min(T/30,1)`, `FH = min(chuva/ETP,1)`, M de 30 a 120). **Não são o mesmo modelo.** Aqui vale a versão acima.

## Decisões de arquitetura e produto (fechadas com o Lucas)

- **Banco próprio**, separado do PV Pro. Novo projeto Supabase, novo repositório, novo deploy.
- **PWA instalável** hospedado na Vercel, backend Supabase. Mesma stack do PV Pro: Vite, React 18, TypeScript, Tailwind, Zustand, React Router, Leaflet, Recharts, vite-plugin-pwa.
- **Supabase Pro** para dados de cliente. O plano gratuito pausa o projeto (aconteceu duas vezes no PV Pro) e não faz backup.
- APK só depois, se houver Bluetooth ou loja (Capacitor empacota o mesmo código). A pesagem com balança Tru-Test é um app separado do Lucas e não faz parte deste.
- O localStorage do simulador é só do protótipo. O app real precisa de login, multiusuário e sincronização, com fila offline.
- Fazenda nasce de **KML/KMZ** (JSZip para o KMZ; `parseKML` do simulador é ponto de partida). Piquetes em módulos (grupos de rodízio) que o usuário monta.

### Caderno da equipe (link do vaqueiro)

Padrão do PV Pro, reaproveitar o **padrão**, não o código:

- Cada fazenda tem `share_token`. O link público abre um formulário **sem login**.
- Tabela de relatos em que o anônimo **só insere**, e só com token válido (RLS com função `SECURITY DEFINER` que confere o token). Só membros da fazenda leem, editam ou apagam.
- O vaqueiro informa **data** (hoje, ontem ou outra) porque costuma avisar depois. Relato sem data cai no dia do envio, nunca em "hoje".
- Relato fica "novo". O consultor revisa, edita e **lança** como evento oficial. Badge de pendência no app.
- Funciona offline: fila local, cópia da lista de piquetes e lotes no aparelho, sincroniza ao abrir, ao voltar o sinal e a cada 2 min.
- **Escopo definido pelo Lucas:** só **chuva** e **mudança de gado**. **Sem pesagem** e **sem ocorrência** no caderno. Pesagem entra só pelo consultor.
- Consequência aceita: o peso do lote fica parado entre visitas, então a lotação de lotes que ganham peso sai levemente subestimada. Exigir pelo menos uma pesagem no início e uma no fim de qualquer período de teste.
- Lançar mudança de gado grava saída e entrada pela regra da transação com `seq` (invariante 2) e das demais invariantes acima.

Ações de campo (chuva, mudança) **nunca** ficam em chunk carregado sob demanda: sem sinal o download pendura e a tela gira para sempre. Telas de escritório (análise, projeção, importação de KML) podem ser lazy, com fallback de 8 s que oferece "tentar de novo". Toda chamada ao Supabase com timeout de 8 s, para o fallback do cache poder disparar.

## Tela e comportamento do simulador (referência de produto)

Seis áreas: **Painel** (indicadores e alertas), **Mapa** (piquetes coloridos, cartão ao tocar), **Módulos** (montar rodízio, ordem, ocupação), **Rebanho** (lotes, pesagem, alteração com data passada, suplemento), **Clima** (gráfico, registro real de chuva), **Análise** (alterna Histórico e Projeção; adubação). Mais cadastro de fazenda por KML.

Capturas em `reference/telas/`.

### Design

Escuro com verde-limão. Variáveis do simulador: fundo `#0B120E`, card `#121C16`, linha `#223028`, texto `#EEF3EC`, texto secundário `#9DB0A3`, destaque `#C6F24E`, alerta `#FF8A3D`, tom "sem dado" `#3A433E`, rampa verde `#1E3A2B`, `#2F6B4A`, `#5DB383`. Série de projeção azul `#6FA8FF`. Fontes: Space Grotesk nos títulos e números grandes, Inter no corpo, números tabulares. Alvos de toque de 44 px.

## Pendências e riscos conhecidos

1. Regra do suplemento (28% × 40% a 1% do PV). Aberta.
2. Consumo de 2,5% do PV fixo para todas as categorias. Aberto.
3. Cenários de chuva da projeção são simulados. Trocar por histórico real.
4. Nada foi testado com fazenda real. Falta um cliente com 60 a 90 dias de movimentação e o KML dele.
5. A versão mobile da projeção foi gerada, mas não foi inspecionada visualmente.
6. Importação de histórico por planilha foi discutida e **descartada por ora**, porque os clientes não têm histórico. O caderno do vaqueiro é o caminho para o dado nascer.
7. ~~Nome do sistema indefinido.~~ Definido: PVPro3.
8. A estação Davis de uma fazenda cliente tem só ~15 dias de dado, não serve de teste histórico.

## Roteiro proposto

1. **Base:** projeto Supabase, schema do log de eventos, login, cadastro de fazenda por KML, piquetes, módulos, lotes e situação de hoje. Detalhe em "Etapa 1: plano aprovado".
2. **Caderno:** link público com chuva e mudança de gado, caixa de revisão, lançamento como evento, fila offline.
3. **Cálculo:** portar de `reference/simulador/app.html` para módulos TypeScript puros (`derive`, `lastOcc`, `padState`, `padYear`, suplemento, projeção, conta de N), cada um com teste. O HTML **não** vira o app.
4. **Painel, mapa, rebanho, clima real, análise** sobre dados reais.
5. **Teste** com um cliente por 60 a 90 dias, clima do centroide.

## Etapa 1: plano aprovado (15 nov 2026)

Aprovado pelo Lucas como plano. **Aprovar o plano não foi ordem para codar**: a regra de autorização de código continua pendente (ver Regras de trabalho).

### Decisões

1. Eventos ordenados por `data + seq` (ver invariante 2).
2. Lotes e "situação de hoje" entram na etapa 1, porque o caderno (etapa 2) precisa de lote cadastrado e de saber onde ele está. Junto entra o núcleo mínimo de "onde está o lote", em TypeScript puro com teste. O resto do cálculo fica na etapa 3.
3. Tipos de evento com nomes separados para animais e para piquete (ver Modelo de dados).

### Banco

| Tabela | O que guarda |
|---|---|
| `farms` | nome, município, centroide, `share_token` |
| `farm_members` | usuário, fazenda, papel |
| `paddocks` | nome, polígono em lat/lon (GeoJSON), área em ha, capim, se é pastejo, última saída informada na abertura |
| `water_points` | bebedouros do KML |
| `modules` | nome, cor, dias de ocupação, lote planejado, condição (extensiva/adubada), M de referência |
| `module_compositions` | ordem dos piquetes com "vale a partir de" |
| `lots` | só nome. Cabeças, peso, categoria e piquete atual são sempre derivados |
| `lot_events` | o log: data, `seq`, tipo, valores, autor, `deleted_at` |

- Só membro da fazenda lê e grava; anônimo não vê nada. A checagem de vínculo fica numa função `SECURITY DEFINER`.
- Sem exclusão física em nenhuma tabela, só `deleted_at`.
- IDs gerados no aparelho (UUID), para a fila offline da etapa 2 não duplicar registro.
- Toda chamada com timeout de 8 s e paginação por `data, id` desde o início.

### KML

`parseKML` do simulador é o ponto de partida, com três correções: guardar a lat/lon original (o simulador converte para metros e descarta), descontar buracos do polígono (`innerBoundaryIs`), e abrir KMZ com JSZip. Reimportar mapa ou redesenhar piquete de fazenda já aberta fica fora da etapa 1; dá para renomear, trocar capim e marcar como fora do pastejo.

### Ordem de entrega

1. Repositório, esqueleto do PWA com o design do simulador, deploy na Vercel.
2. Projeto Supabase, migrações versionadas, regras de acesso com teste.
3. Login por e-mail e senha com sessão persistente, lista de fazendas.
4. Abertura de fazenda: dados, mapa por KML/KMZ, capim.
5. Módulos, com histórico de composição.
6. Lotes e situação de hoje.

**Pronto quando:** o Lucas abre uma fazenda real pelo KML no Android, as áreas batem com as conhecidas (até 1%), monta os módulos, sai e entra de novo, e um segundo usuário sem vínculo não enxerga nada. Testes verdes e versão publicada.

### Falta para começar

- Resposta sobre a regra de autorização de código.
- Um KML ou KMZ real de cliente para testar a importação.
- Pasta do projeto e nome provisório do repositório.
- Contas Supabase e Vercel criadas pelo Lucas. Sugestão: plano gratuito no desenvolvimento, Pro antes de entrar dado de cliente.

## Achados da revisão do simulador (Claude, 15 nov 2026, não decididos)

Vêm da leitura do código, sem execução.

1. **Suplemento:** "1% corta 40%" equivale a substituição 1:1 sem limiar (40% de 2,5% do PV = 1,0% do PV). Com limiar de 0,3%, dar 40% exigiria 1,43 kg de capim por kg de suplemento. As duas regras não convivem; é escolher uma.
2. **M calibrado:** é ajustado à lotação praticada, então mede o manejo e não a capacidade do pasto. Fazenda sublotada sai com M baixo.
3. **Dois lotes no mesmo piquete:** `lastOcc` segue só o lote que saiu por último, e a ocorrida do piquete em descanso sai subestimada. `padState` (ocupado) e `padYear` somam todos.
4. **Período de pastejo é do lote ou do piquete?** Se o lote A sai e o B entra no mesmo dia, o simulador trata como dois períodos e mostra só o do B.
5. **Projeção no celular (390 px):** a tabela "Mês a mês" corta depois de PPR; a coluna Observação da dose de N corta o texto; a coluna "Falta" é média da fazenda e a dose de N soma o déficit por módulo, então aparecem linhas com falta "—" e dose maior que zero.

## Mapa de `reference/`

- `simulador/app.html`: protótipo completo em arquivo único (HTML/CSS/JS puro). Rodar abrindo no navegador. Estado em `localStorage` (chave `sim-pastejo-v6`).
- Funções para portar: `derive`, `closeZero`, `validate`, `mutate`, `stateAt`, `openStay`, `lastOcc`, `padState`, `modInfo`, `padYear`, `cutF`/`pastoF`, `rainVal`, `eto`, `climSeries`, `projUnits`, `projModel`, `projScope`, `nPlan`, `parseKML`.
- `simulador/test*.js`: testes de fluxo em jsdom. Servem como especificação do comportamento. Rodar de dentro de `reference/simulador/` com `npm install` e `node test5.js` (cada um imprime `OK`/`FAIL` por passo e `ERRORS []` no fim).
- `telas/`: capturas do simulador em desktop e celular.
