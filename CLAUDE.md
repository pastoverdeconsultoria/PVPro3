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

**Período de pastejo é do piquete, não do lote** (decidido em 16 nov 2026 pelo Claude, por delegação do Lucas: "faça como preferir"). Enquanto houver gado no piquete é um período só: se um lote sai e outro entra no mesmo dia, o período continua; dois lotes juntos somam as UA; só um dia inteiro vazio encerra. O simulador fazia por lote e subestimava a ocorrida com dois lotes. Implementado em `src/lib/calc/occupancy.ts` (`paddockPeriods`). O Lucas pode rever.

Convenção de dias: o dia pertence ao piquete onde o lote termina o dia. Entrou em 1/11 e saiu em 13/11 são 12 dias de pastejo. Para quem ainda está no piquete, hoje conta. A global do ciclo divide pelos dias desde o início do último pastejo até hoje, inclusive.

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
- **Ponto aberto:** a regra original dele era "1% de suplemento diminui 40% do consumo de capim". Com limiar de 0,3% o simulador dá cerca de 28% a 1% do PV. Em 16 nov 2026 o Lucas delegou a escolha ("faça como preferir") e o Claude ficou com o limiar de 0,3% (28% a 1% do PV). A regra está isolada em `src/lib/calc/supplement.ts`; para a regra dos 40% basta pôr `thresholdPct: 0`. O Lucas pode rever.

## Clima

- Dados pelo **centroide** da fazenda, como no PV Pro: Open-Meteo (ERA5) para histórico de Tmax, Tmin e chuva. Não depende de pluviômetro para o histórico.
- **Chuva real** registrada (pluviômetro ou vaqueiro) tem prioridade sobre a estimada do dia. Gráfico com os dois, marcando qual é qual.
- No simulador o clima é **sintético e determinístico** (`rnd` com seed, normais de Itapetinga). Substituir pela API real.
- ETo por Hargreaves-Samani (precisa de latitude e Tmax/Tmin). Balanço hídrico diário simples com CAD de 75 mm e Kc mensal (0,6 de mai a jul; 1,2 em nov e de dez a fev; 0,9 nos demais; hemisfério sul).
- **Divergência achada em 17 nov 2026, não decidida pelo Lucas:** os meses do Kc acima não batem com o código do simulador que ele aprovou. O código usa mês contado a partir de zero (`m>=5&&m<=7`, `m===11||m<=1`), o que dá **0,6 de junho a agosto e 1,2 de dezembro a fevereiro**. O app segue o código do simulador (`kcOf` em `src/lib/climate/water.ts`), que é o que rodou e faz sentido para a seca da Bahia. Se o Lucas quiser maio a julho, é trocar três números.

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
- **Escopo definido pelo Lucas:** só **chuva** e **mudança de gado**. **Sem pesagem** e **sem ocorrência** no caderno. Pesagem entra pelo consultor ou, desde 18 nov 2026, pelo cliente com conta "leitura + campo" (tela Campo).
- Consequência aceita: o peso do lote fica parado entre visitas, então a lotação de lotes que ganham peso sai levemente subestimada. Exigir pelo menos uma pesagem no início e uma no fim de qualquer período de teste.
- Lançar mudança de gado grava saída e entrada pela regra da transação com `seq` (invariante 2) e das demais invariantes acima.

Ações de campo (chuva, mudança) **nunca** ficam em chunk carregado sob demanda: sem sinal o download pendura e a tela gira para sempre. Telas de escritório (análise, projeção, importação de KML) podem ser lazy, com fallback de 8 s que oferece "tentar de novo". Toda chamada ao Supabase com timeout de 8 s, para o fallback do cache poder disparar.

## Tela e comportamento do simulador (referência de produto)

Seis áreas: **Painel** (indicadores e alertas), **Mapa** (piquetes coloridos, cartão ao tocar), **Módulos** (montar rodízio, ordem, ocupação), **Rebanho** (lotes, pesagem, alteração com data passada, suplemento), **Clima** (gráfico, registro real de chuva), **Análise** (alterna Histórico e Projeção; adubação). Mais cadastro de fazenda por KML.

Capturas em `reference/telas/`.

### Design

Escuro com verde-limão. Variáveis do simulador: fundo `#0B120E`, card `#121C16`, linha `#223028`, texto `#EEF3EC`, texto secundário `#9DB0A3`, destaque `#C6F24E`, alerta `#FF8A3D`, tom "sem dado" `#3A433E`, rampa verde `#1E3A2B`, `#2F6B4A`, `#5DB383`. Série de projeção azul `#6FA8FF`. Fontes: Space Grotesk nos títulos e números grandes, Inter no corpo, números tabulares. Alvos de toque de 44 px.

## Pendências e riscos conhecidos

1. ~~Regra do suplemento (28% × 40% a 1% do PV).~~ Escolhido o limiar de 0,3% por delegação; o Lucas pode rever.
2. Consumo de 2,5% do PV fixo para todas as categorias. Aberto.
3. ~~Cenários de chuva da projeção são simulados.~~ Feito: saem do histórico real do centroide (ver Estado da etapa 4).
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

### Estado da etapa 1 (16 nov 2026)

O código da etapa 1 está escrito e testado (ver `README.md`, seções Estrutura e Testes). Em 15 nov 2026 o Lucas autorizou com "Eu quero o app funcionando. Faça todo o código pra isso acontecer"; isso valeu para a etapa 1 inteira. Para as etapas seguintes, perguntar de novo.

O que ainda não foi feito ou conferido:

- A migração `supabase/migrations/20261115120000_base.sql` precisa ser rodada pelo Lucas no SQL Editor do projeto Supabase `pvpro3`, e as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` precisam ser criadas na Vercel.
- A ligação com o Supabase real (`src/data/supabaseRepo.ts`) nunca rodou contra um projeto de verdade. As regras de acesso foram provadas num Postgres local (PGlite), não no Supabase.
- O critério "pronto quando" (Lucas abre fazenda real no Android, áreas batem, segundo usuário não enxerga nada) depende dele.
- Decidido na implementação, sem perguntar ao Lucas, e pode ser revisto: a lotação global da fazenda usa só o gado dentro de piquete de pastejo (como o simulador mostra "UA em pastejo"); o cartão do piquete mostra a lotação instantânea e o último período, mas a ocorrida e a global do ciclo ficaram para a etapa 3; o GMD usa só registros de pesagem (o peso do cadastro não conta, a menos que marcado como peso de balança); transferência entre lotes não tem tela.
- Sem sinal o app abre e mostra a última cópia salva, mas não grava. A fila offline é da etapa 2.

### Estado da etapa 2 (16 nov 2026)

Em 16 nov 2026 o Lucas confirmou que a etapa 1 funciona no ar (login, abertura de fazenda) e disse "Continue o projeto". O caderno da equipe está escrito e testado (ver `README.md`).

- App publicado em `https://pv-pro3.vercel.app`, banco no projeto Supabase `pvpro3`. A Vercel publica a cada envio ao `main`. O botão Redeploy da Vercel pede código por e-mail, e a caixa do Lucas está cheia: para republicar, enviar um commit.
- A migração `supabase/migrations/20261116120000_caderno.sql` precisa ser rodada pelo Lucas no SQL Editor. Enquanto não for, o app tolera a falta das tabelas e avisa nas telas Caderno e Clima.
- Não conferido no Supabase real: as funções do link público e o lançamento de relato. Só no Postgres local (PGlite) e no banco em memória dos testes.
- Decidido na implementação, sem perguntar ao Lucas, e pode ser revisto: o relato chega ao banco por função com conferência de token (o anônimo não tem permissão em tabela nenhuma), em vez de política de inserção; a chuva é uma tabela própria com várias leituras por dia, que se somam, e ao lançar num dia que já tem leitura o consultor escolhe somar ou substituir; o link pode ser trocado, e o antigo para de valer; o fuso para "hoje" no servidor é America/Bahia; relato com mais de 120 dias é recusado; o caderno aceita no máximo 500 relatos novos por fazenda.
- **Tela do vaqueiro igual à do PV Pro, com emojis** (pedido do Lucas em 16 nov 2026, para quem tem baixa escolaridade): nome uma vez só (👋), dois botões gigantes (🌧️ CHOVEU e 🐮 MUDEI O GADO), teclado numérico grande para os milímetros, lote escolhido numa lista com "está no pasto X · N cabeças", pasto escolhido tocando no mapinha ou num botão, ☀️ Hoje / 🌙 Ontem / 📅 Outro, e telas ✅ Enviado, 📥 Guardado e ⚠️ Não deu certo. Um passo por vez, sem campo de texto além do nome. Manter esse padrão em qualquer mudança: figura grande, pouca leitura, nada de digitar. A paleta continua a escura com verde-limão. Diferenças para o PV Pro: a data é perguntada também na mudança de gado (regra deste projeto), e não há escolha de pluviômetro.
- Por causa dessa tela, a função `notebook_context` devolve, além dos nomes, o contorno simplificado de cada piquete (até ~40 pontos), as cabeças de cada lote e onde ele está (o relato de mudança ainda não revisado vale mais que o histórico oficial). Continua sem área, peso e categoria. Lote sem animais não aparece.
- O consultor não tem fila offline: sem sinal ele vê a cópia salva e não grava. Só o caderno do vaqueiro guarda e envia depois.

### Estado da etapa 3 (16 nov 2026)

O cálculo de lotação está escrito e testado, em TypeScript puro (`src/lib/calc/`): suplemento, trechos de estadia com UA-dia, período de pastejo do piquete, ocorrida, global do ciclo e a lotação no período para a Análise. Não depende de nenhuma migração nova.

- No mapa, o cartão do piquete em descanso mostra a ocorrida do último pastejo e a global do ciclo; o ocupado mostra a instantânea e a ocorrida até agora. Com suplemento, aparece também a versão "de pasto". O percentual de capim substituído não aparece em tela nenhuma.
- A Análise mostra a lotação global no período, por mês, por módulo e o ranking dos piquetes.
- Decidido na implementação e pode ser revisto: enquanto a fazenda tem menos de um ano de registro, a "lotação anual" é a lotação do período registrado, a partir da primeira entrada de gado (dividir 30 dias por 365 daria um número falso), e a tela avisa; a lotação por módulo na Análise usa a composição de hoje, não a de cada data; o ranking usa a lotação de pasto quando houve suplemento.
- **Não portado do simulador:** a projeção de capacidade de suporte, a conta inversa de N e o M calibrado. Dependem do clima pelo centroide (etapa 4). O M calibrado segue com a ressalva dos achados da revisão: mede o manejo, não a capacidade do pasto.
- Os números da ocorrida não foram comparados com dados de fazenda real, só com contas feitas à mão nos testes.

### Estado da etapa 4 e complementos (17 nov 2026)

Em 16 nov 2026 o Lucas disse "Continue. Faça tudo que tem pra fazer". Foi feito e testado (ver `README.md`):

- **Clima pelo centroide** (Open-Meteo, direto do navegador, sem chave). A coordenada vai arredondada para duas casas (~1 km). Dez anos de ERA5 mais 92 dias recentes e 7 de previsão, guardados no aparelho por 6 horas.
- **Projeção**, portada do simulador com as mesmas fórmulas e a mesma memória do crescimento (peso 0,4 quando não calibrado). M calibrado existe e só aparece com 6 meses de lotação registrada; a tela deixa alternar para o M de referência e explica que o calibrado mede o manejo.
- **Cenários de chuva pelo histórico real**, no lugar dos multiplicadores de 75% e 125%: para cada mês do ano, o ano do quantil 20% (seco), a mediana (normal) e o quantil 80% (chuvoso) dos últimos dez anos; o futuro repete os dias reais desse ano. Decisão do Claude, pode ser revista (os quantis e o número de anos são parâmetros).
- **Dose de N**, registro de adubação por piquete e aviso no Painel acima de 5% da capacidade do mês.
- **Fila de trocas**, **transferência entre lotes**, **renomear fazenda**, **dar e tirar acesso por e-mail** (só o dono; a pessoa precisa já ter conta) e **consultor registrando sem sinal** (fila no aparelho para mudança, registros do lote, lote novo, transferência e chuva; ações de escritório continuam exigindo sinal).
- A migração `supabase/migrations/20261117120000_adubacao_membros.sql` precisa ser rodada pelo Lucas. `supabase/pendentes.sql` junta as migrações 2 e 3. Sem elas o app avisa nas telas e segue funcionando.

Não conferido: nada disso rodou contra o Supabase real nem em celular de verdade. O clima foi conferido contra o Open-Meteo só no formato da resposta, com as coordenadas da fazenda inventada; a projeção nunca foi comparada com fazenda real. Com menos de três anos de histórico disponível num ponto, não há cenário e os meses à frente ficam sem projeção (a tela avisa).

Feito depois, em 17 nov 2026, sem depender de SQL: zoom e arrasto no mapa (`FarmMap`) e correção da data de um registro (`changeEventDate`: apaga o antigo de forma suave e grava um novo; se o novo não entra, devolve o antigo).

Ainda não existe: reimportar KML ou redesenhar piquete e excluir fazenda (precisam de permissão nova no banco), corrigir outro campo de um registro além da data, e satélite no mapa.

### Revisão de segurança (17 nov 2026)

Feita pelo Claude a pedido do Lucas, lendo o SQL e o código. Corrigido no código:

- Cabeçalhos no `vercel.json`: política de conteúdo (só roda script do próprio site; só conversa com o Supabase e o Open-Meteo), `Referrer-Policy: no-referrer` (o endereço do caderno tem o token), sem indexação em busca, sem moldura em outro site, e só o GPS liberado. Qualquer serviço novo que o app chame precisa entrar no `connect-src`, senão o navegador bloqueia.
- Limite de tamanho no arquivo de mapa (25 MB, e 60 MB descompactado) e de 2.000 polígonos.

Conferido e sem achado: nenhuma tabela tem acesso de anônimo nem DELETE; toda função com privilégio elevado fixa o `search_path` e confere vínculo ou token; o app não usa HTML cru nem `eval`; a chave publicada é a pública.

Riscos que dependem de configuração do Lucas no Supabase, não de código:

- **Confirmação de e-mail desligada.** Com ela desligada, qualquer pessoa cria conta com o e-mail de outra. Se o dono der acesso a esse e-mail, quem criou a conta falsa entra na fazenda. Religar "Confirm email" antes de usar "Dar acesso" com gente de fora.
- Criação de conta aberta a qualquer um. Resolvido pela regra de acesso abaixo, quando o hook for ligado.
- Senha mínima de 6 caracteres (padrão do Supabase). Subir o mínimo e ligar a proteção contra senha vazada.
- Plano gratuito: sem backup e pausa por inatividade.

Limites conhecidos, aceitos por ora: o link do caderno é o segredo (quem tem o link vê nomes de piquetes e lotes, cabeças e o contorno simplificado, e pode mandar até 500 relatos); o servidor não refaz as regras do histórico do lote (confia na conferência do app, que roda antes de gravar); a sessão fica no armazenamento do navegador, como em todo app Supabase.

### Regra de acesso (pedida pelo Lucas, 18 nov 2026)

"Meu login acessa todas; o cliente só a fazenda dele; ninguém cria conta sem minha permissão." Migração `20261118120000_convites.sql`:

- **Administrador** (`app_admins`): só ele abre fazenda nova (gatilho em `farms`). Quem era dono de fazenda quando a migração rodou virou administrador. O Lucas vê todas porque abre todas; administrador **não** enxerga fazenda de que não é dono. Se um dia houver mais de um consultor, decidir se administrador vê tudo.
- **Convite** (`farm_invites`): "Dar acesso" com e-mail sem conta cria convite. O cliente toca em "Criar conta" com esse e-mail; ao entrar, `claim_farm_invites` vira acesso (só com e-mail confirmado). Convite pode ser cancelado.
- **Trava de cadastro**: `hook_before_user_created` recusa e-mail sem convite aberto. Só funciona depois de ligado no painel (Authentication → Hooks → Before User Created → Postgres → essa função). Não se sabe se o hook também barra "Invite user" do painel do Supabase; o caminho previsto é o convite pelo app.
- **Tipo de acesso** (migração `20261119120000_leitura.sql`, pedido do Lucas em 18 nov 2026): `viewer` = "leitura + campo", padrão do convite, pensado para o cliente. Vê tudo; grava só mudança de piquete, pesagem e chuva, e só desfaz o que ele mesmo gravou desses tipos. A regra está no banco (políticas com `is_farm_editor`), não só na tela. `member` = acesso completo. O dono troca um pelo outro em "Quem tem acesso".
- **Tela Campo** (`/campo`): o caderno dentro do app, com botão grande e emoji: 🐮 mudei o gado, 🌧️ choveu, ⚖️ pesei. Grava direto no histórico (não é relato para revisar) e tem "Errei, desfazer" logo depois de gravar. Para o leitor ela substitui a aba Módulos; quem edita chega por Rebanho → Campo.
- O caderno público do vaqueiro continua **sem pesagem**. Pesagem entra pelo consultor ou pelo cliente com conta.
- **Esqueci a senha**: o link do e-mail volta para `/?senha=nova` e abre a tela de senha nova (mínimo de 8 caracteres). Exige `https://pv-pro3.vercel.app/**` em Authentication → URL Configuration → Redirect URLs. O envio de e-mail do Supabase sem SMTP próprio tem limite baixo por hora.

Ideias incluídas sem pedido, que o Lucas pode tirar: aviso de pesagem com mais de 45 dias no Painel; limpeza do nome do piquete que traz a área junto; criar módulo já com o grupo de piquetes da mesma pasta ou letra; GPS no mapa e no caderno.

O KML real usado para testar a importação fica fora do repositório, por decisão do Lucas. Nenhum nome de fazenda real entra no repositório, que é público.

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
