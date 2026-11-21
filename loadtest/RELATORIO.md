# Relatório: simulação de usuários no cineark.com.br (04/11/2026)

**Alvo:** produção (`https://cineark.com.br`, deploy do `main`, `afaaeab`). Os planos da Netlify e do Supabase são gratuitos.
**Fora da carga:** `/mangadex` (API de terceiros com limite), `/api/discover` e `/api/translate-page` (IA, cobradas por chamada).

## 1. Teste de carga: rampa de 1 a 20 usuários virtuais em 5 min (`load.mjs`)

| Endpoint | Req | Erros | p50 | p95 | p99 | máx |
|---|---|---|---|---|---|---|
| `GET /` (HTML, CDN) | 489 | 0% | 69 ms | 84 ms | 151 ms | 282 ms |
| Assets estáticos (29 por 1ª visita) | 580 | 0% | 212 ms | 525 ms | 913 ms | 1,2 s |
| `GET /obra/:slug` (função Netlify + Supabase) | 962 | 0% | 273 ms | 365 ms | 536 ms | 1,8 s |
| Supabase REST: últimos capítulos | 489 | 0% | 169 ms | 293 ms | 853 ms | **9,8 s** |
| Supabase REST: disponibilidade do catálogo | 489 | 0% | 169 ms | 264 ms | 822 ms | **9,8 s** |
| `GET /sitemap.xml` | 59 | 0% | 36 ms | 239 ms | 292 ms | 292 ms |
| **Total** | **3.068** | **0%** | **195 ms** | **357 ms** | | |

O teste fez cerca de 10 requisições por segundo. Com 20 usuários não houve degradação: no pico, `/obra/:slug` ficou com p95 entre 333 e 368 ms.

### 1b. Rampa de 1 a 50 usuários virtuais em 5 min

| Endpoint | Req | Erros | p50 | p95 | p99 | máx |
|---|---|---|---|---|---|---|
| `GET /` | 1.198 | 0% | 39 ms | 77 ms | 153 ms | 469 ms |
| Assets estáticos | 1.450 | 0% | 44 ms | 403 ms | 546 ms | 1,6 s |
| `GET /obra/:slug` | 2.418 | 0% | 260 ms | 437 ms | 627 ms | 1,9 s |
| Supabase: disponibilidade do catálogo | 1.198 | 0% | 168 ms | 226 ms | 406 ms | 768 ms |
| Supabase: últimos capítulos | 1.198 | 0% | 170 ms | 387 ms | 831 ms | 3,3 s |
| **Total** | **7.593** | **0%** | **169 ms** | **359 ms** | | |

O teste fez cerca de 25 requisições por segundo, 2,5 vezes mais que o de 20 usuários, e **as latências quase não mudaram**. O p95 de `/obra/:slug` foi de 365 para 437 ms. Só uma requisição passou de 2 s. O pico de 9,8 s visto no teste de 20 usuários **não se repetiu**, então parece ter sido transitório: aquecimento do projeto Supabase depois de ficar ocioso, ou uma rajada isolada. Não é saturação.

## 2. Jornadas no navegador: 5 usuários × 2 rodadas, metade em celular (`journeys.mjs`)

| Etapa | p50 | p95 | Falhas |
|---|---|---|---|
| Abrir home | 635 ms | 1,1 s | 0 |
| **Passar a introdução (1ª visita)** | **8,8 s** | **8,8 s** | 0 |
| Buscar obra | 0,9 s | 1,0 s | 0 |
| Abrir obra | 0,6 s | 8,3 s* | 0 |
| Abrir capítulo (até a 1ª imagem) | 1,6 s | 2,1 s | 0 |

\* Esse valor de 8,3 s vem do tempo que o script esperou antes de concluir que a obra não tinha capítulos (veja o item C).

FCP ficou entre 0,5 e 0,9 s e LCP entre 0,5 e 1,0 s, ambos bons. **O CLS no desktop ficou entre 0,25 e 0,31, o que é considerado ruim** (o limite bom é 0,1). No celular variou de 0,01 a 0,24.
Não houve nenhum erro de console, nenhuma resposta HTTP >= 400 e nenhuma requisição falha.

## Gargalos e problemas encontrados

**A. A introdução bloqueia o site por cerca de 8,8 s na primeira visita.** Em produção, a tela de splash ignora os cliques até ficar "pronta" (`readyToEnter`) e não oferece botão para pular. O visitante clica, nada acontece e não há nenhum aviso. Os 10 usuários simulados ficaram presos de 8,8 a 8,8 s. O botão "Pular introdução" já existe no branch local `melhorias/temas-disponibilidade-ci` (commit `5060398`), mas **ainda não foi publicado**. O `main` publicado está atrás desse branch.

**B. A home está pesada no desktop: CLS entre 0,25 e 0,31.** Algum elemento muda de posição depois do carregamento, provavelmente o destaque ou as prateleiras que aparecem depois das consultas ao Supabase, ou as capas sem dimensões reservadas.

**C. Uma obra da prateleira da home não tem capítulos.** `/obra/o-retorno-do-heroi-de-classe-desastre-fb768dc8` foi aberta 3 vezes em 10 e não tinha nenhum capítulo na nuvem, o que deixa o leitor sem saída.

**D. Picos no Supabase.** Por volta dos 56 a 59 s do teste (entre 8 e 10 usuários), as duas consultas REST demoraram de 3,5 a 9,8 s ao mesmo tempo. Fora desse momento, ficaram com p95 abaixo de 300 ms. O padrão é compatível com o pool de conexões ou a CPU do plano gratuito sob uma rajada de consultas pesadas (`catalog-availability` faz join com contagem de `ark_chapters`). No 1º minuto, o p95 de `/obra/:slug` também foi maior (713 ms), por causa de cold start da função. **Atualização:** no teste com 50 usuários o pico não voltou a acontecer (máximo de 768 ms nessa consulta). O problema é transitório e tem prioridade baixa.

**E. 29 assets separados na primeira visita**, com p95 de 525 ms e p99 de 913 ms. Cada script do Vue vem em um arquivo próprio.

## Recomendações (em ordem de impacto)

1. **Publicar o branch com o botão "Pular introdução"** ou permitir o clique imediato na splash. É o maior problema de UX encontrado.
2. **Reservar espaço na home** (`width`/`height` ou `aspect-ratio` nas capas e altura mínima no destaque e nas prateleiras) para baixar o CLS do desktop para menos de 0,1.
3. **Esconder das prateleiras as obras sem capítulos publicados**, ou mostrar um aviso claro. A disponibilidade já é consultada (`loadCatalogAvailability`).
4. **Reduzir o custo da `catalog-availability`:** criar uma view ou RPC materializada com a contagem e a última data por obra, ou cache curto (por exemplo, `Cache-Control` em uma função Netlify), e índice em `ark_chapters(work_id, published, archived_at)`. Isso também diminui o risco de esgotar o plano gratuito.
5. **Concatenar ou minificar os JS de `assets/js`** em um bundle e usar cache imutável com hash no nome dos arquivos.
6. **Capacidade:** 50 usuários simultâneos (cerca de 25 req/s) já passaram sem erros e sem degradação. Para ir além disso (100 ou mais), acompanhe o painel do Supabase (conexões e CPU) e a cota de invocações de função da Netlify durante o teste. O script limita a 50 VUs (`MAX_VUS`); aumente esse limite de propósito, se for o caso.

## Como repetir
Veja o `README.md` desta pasta. Os resultados brutos (JSON) ficam em `loadtest/results/`.
