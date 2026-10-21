# Tradução de páginas com Gemini

## Busca por intenção de leitura

No catálogo, **Encontre sua próxima jornada → Buscar com Gemini** permite descrever uma leitura e receber até seis sugestões com justificativas, trechos dos metadados e limitações. A busca por título permanece independente. Não exige conta e não altera o histórico. O modelo só pode devolver IDs do catálogo analisado; citações inexistentes e respostas incompletas são rejeitadas, sem apresentar uma busca comum como se fosse IA.

Essa integração reaproveita `GEMINI_API_KEY` exclusivamente no servidor. Há uma função Netlify em `/api/discover` e o mesmo endpoint no servidor Node/Render. A variável precisa estar no serviço que atende esse endpoint: configurá-la apenas no Render não a disponibiliza automaticamente às funções Netlify. O modelo padrão é `gemini-3.5-flash-lite`, separado da tradução por `GEMINI_DISCOVERY_MODEL`.

Somente a descrição digitada e os campos públicos título, tipo, gêneros e sinopse são enviados ao Google. Capítulos, imagens, anotações, e-mail e histórico pessoal não participam da busca. A interface avisa sobre esse envio antes de submeter. As justificativas geradas podem conter imprecisões mesmo com trechos válidos; os trechos ficam disponíveis para conferência. Dados ausentes, como a quantidade de romance, não devem ser apresentados como confirmados.

O servidor consulta até 2.000 obras públicas, exclui Anime e pré-seleciona até 80 por termos presentes no pedido. Para bibliotecas maiores que 80 obras, essa pré-seleção pode deixar de fora sugestões semanticamente próximas; a interface informa quantas foram analisadas. A busca comum continua consultando o catálogo completo. As sinopses enviadas são limitadas a 1.200 caracteres, o que também pode limitar a correspondência.

Limites por processo: duas consultas simultâneas, dez novas buscas por origem de conexão/hora e cem chamadas ao Gemini por dia. Resultados iguais são reutilizados por dez minutos, e o catálogo por cinco. Os limites e caches reiniciam com o processo e não são compartilhados entre instâncias ou funções Netlify; use cotas do projeto Google para controle durável. No Netlify, a origem vem do IP fornecido pela plataforma, armazenado somente como hash no processo. No servidor Node, usa-se o endereço da conexão, que pode ser compartilhado por leitores atrás do proxy Render. Não são confiados cabeçalhos de IP enviados pelo cliente.

No Live Server, execute também `npm start`; o navegador consulta `http://127.0.0.1:8787/api/discover`. Cancelar interrompe a espera na interface; não garante cancelamento de uma chamada que o servidor já enviou ao Gemini. Falhas de cota não provocam repetição automática. A chave não foi lida nem copiada dos servidores existentes, e os testes locais simulam o Gemini; a chamada real precisa ser conferida após publicar no serviço com a variável configurada.

Esta entrega implementa a busca por intenção. Resumos por capítulo e o grimório com conhecimento limitado ao progresso do leitor são etapas separadas e precisam de fontes revisadas antes da implementação.

Referências: [respostas estruturadas do Gemini](https://ai.google.dev/gemini-api/docs/structured-output), [modelo utilizado](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).

A tradução é opcional e acionada por **Traduzir página** no leitor de capítulos enviados à biblioteca. O texto aparece ao lado da arte (abaixo em celulares), com original consultável. A integração inicial não traduz imagens do MangaDex nem cópias locais antigas. Publique as cópias locais pelo painel para utilizá-la.

## Ativar no site publicado

No Render, abra o serviço **cine-ark → Environment → Add Environment Variable**:

- Nome: `GEMINI_API_KEY`
- Valor: sua chave do Google AI Studio, inserida diretamente no painel do Render.

Salve a alteração com uma nova implantação. Nunca cole a chave no chat, no `public/assets/js/config.js` ou no GitHub. O modelo padrão é `gemini-3.5-flash-lite`; `GEMINI_MODEL` permite selecionar outro modelo compatível com visão, JSON estruturado e `generateContent`. O código não altera configurações existentes do Render ao adicionar esta variável.

Entre na sua conta, abra um capítulo enviado à biblioteca e clique em **Traduzir página**. Confira a tradução e o original. Uma chamada real à API ainda precisa ser validada depois da configuração da chave. Não há chave Gemini disponível nesta sessão e nenhum teste pago foi executado.

## Funcionamento

O servidor valida a sessão com Supabase Auth e consulta a página usando o JWT do próprio leitor e as políticas RLS existentes. Não usa `service_role`. O cliente envia somente capítulo, índice e direção de leitura; não pode fornecer URLs ou prompts arbitrários. O servidor obtém a imagem do bucket privado e a envia ao Google somente após o clique do leitor.

Aceita páginas JPG, PNG ou WebP de até 10 MiB para manter o corpo inline dentro do limite de entrada. Não substitui o texto dentro dos balões. A extração pode falhar em textos pequenos, manuscritos e páginas muito longas. Resultados bloqueados, incompletos, inválidos ou com erro não são salvos como traduções válidas.

Até 20 traduções são guardadas no navegador, por conta, capítulo, página e direção. O servidor também mantém até 100 resultados por 24 horas em memória e agrupa solicitações idênticas simultâneas. Esse cache não é um arquivo permanente: reiniciar o servidor ou limpar o navegador pode exigir nova chamada. As traduções ainda não são sincronizadas entre dispositivos.

Para conter uso involuntário, cada processo permite até duas traduções simultâneas, uma por leitor, 20 solicitações novas por leitor/hora e 100 por dia no total. Os contadores reiniciam com o servidor; configure também cotas no projeto Google para um limite de uso durável. Não há tradução automática de capítulos inteiros nem repetição automática após erros de cota.

## Desenvolvimento local

Crie `.env.local` (ignorado pelo Git) com `GEMINI_API_KEY` e execute `npm start`. A chave é carregada somente no servidor. O servidor aceita o Live Server nas origens locais já utilizadas pelo projeto. Não exponha `.env.local` por outro servidor estático.

## Referências

- [Modelo e modalidades](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [API generateContent e dados inline](https://ai.google.dev/api/generate-content)
- [Chaves da API no Google AI Studio](https://aistudio.google.com/api-keys)
