# Tradução de páginas com Gemini

A tradução é opcional e acionada por **Traduzir página** no leitor de capítulos enviados à biblioteca. O texto aparece ao lado da arte (abaixo em celulares), com original consultável. A integração inicial não traduz imagens do MangaDex nem cópias locais antigas. Publique as cópias locais pelo painel para utilizá-la.

## Ativar no site publicado

No Render, abra o serviço **cine-ark → Environment → Add Environment Variable**:

- Nome: `GEMINI_API_KEY`
- Valor: sua chave do Google AI Studio, inserida diretamente no painel do Render.

Salve a alteração com uma nova implantação. Nunca cole a chave no chat, no `config.js` ou no GitHub. O modelo padrão é `gemini-3.5-flash-lite`; `GEMINI_MODEL` permite selecionar outro modelo compatível com visão, JSON estruturado e `generateContent`. O código não altera configurações existentes do Render ao adicionar esta variável.

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
