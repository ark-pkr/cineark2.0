# Simulação de usuários do CINE ARK

Scripts para rodar de novo, a partir da raiz do projeto (`C:\dev\cineark2.0`).

## 1. Teste de carga (sem dependências)
```
node loadtest/load.mjs --vus 20 --minutes 5
```
Cada usuário virtual faz: home (+29 assets na primeira visita) → 2 consultas REST do Supabase (últimos capítulos, disponibilidade do catálogo) → 1 a 3 páginas `/obra/:slug` do sitemap. Pausa de 1 a 4 s entre as ações. Rampa: 60% subindo, 30% no pico, 10% descendo. O teto é de 50 VUs.
Opções: `--base http://localhost:8787`, `--out loadtest/results`.

## 2. Jornadas no navegador (Playwright)
```
cd loadtest && npm install && node journeys.mjs --users 5 --rounds 2
```
Metade dos usuários em desktop e metade em celular (Pixel 7): abrir a home, passar a introdução, medir FCP/LCP/CLS com `ArkUX.performance()`, buscar, abrir uma obra, abrir um capítulo e rolar a leitura. Coleta erros de console, respostas HTTP >= 400 e requisições que falharam. Use `--headed` para ver o navegador.

## Fora da carga, de propósito
- `/mangadex` repassa as chamadas para a API do MangaDex, que tem limite e pode bloquear o IP.
- `/api/discover` chama o Gemini e custa por chamada.
- `/api/translate-page` também chama uma IA.

As jornadas bloqueiam essas rotas, a menos que você passe `--allow-third-party`.

Os resultados (JSON) ficam em `loadtest/results/`, que está fora do git.
