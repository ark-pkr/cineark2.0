# MangaDex no CINE ARK

## Usar no computador

Na pasta do projeto, execute:

```powershell
node scripts/mangadex-server.mjs
```

Mantenha o terminal aberto. O servidor escuta apenas em `127.0.0.1:8787`. Você pode continuar no Live Server em `http://127.0.0.1:5500` ou abrir `http://127.0.0.1:8787`, que serve o mesmo site. Dados locais do navegador são separados por endereço; mantenha o endereço anterior se precisar das cópias locais antigas.

Entre na sua conta, abra uma obra e escolha a aba **MangaDex**. A busca começa com o título da obra. Selecione a edição correta, confira o idioma e abra um capítulo. O padrão é **Português (Brasil)**, com opções de português de Portugal e inglês. Não existe tradução automática das imagens: a fonte precisa disponibilizar o capítulo no idioma escolhido.

Os resultados mostram edições, derivados e nomes alternativos. O programa não escolhe automaticamente a primeira edição. As listas carregam até 100 registros por consulta, com **Carregar mais capítulos**, respeitando os limites da fonte. Capítulos externos, vazios ou marcados como indisponíveis não são incorporados ao leitor. Restrições de acesso da fonte são apresentadas ao usuário, sem tentativas de contorná-las.

## Por que existe um servidor intermediário

As [regras oficiais do MangaDex](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/raw/main/2-limitations.md) exigem proxy para consultas de outros sites e imagens. Consultas diretas do navegador não recebem CORS, e imagens não devem ser incorporadas diretamente dos domínios da fonte.

O intermediário só permite busca, detalhes de obra, lista de capítulos, manifesto de páginas, capa e imagem por índice. Não aceita URLs arbitrárias. Valida IDs, idiomas, índices e hosts de imagem; não encaminha cookies nem tokens Supabase ao MangaDex. Usa um User-Agent próprio, cache breve, consultas espaçadas, limite de imagens simultâneas e pausa após HTTP 429. Requisições de imagens usam o servidor retornado pela API, com HTTPS e lista de domínios permitidos, sem seguir redirecionamentos arbitrários.

As páginas são carregadas sob demanda. Não são copiadas para o Storage e não há download da série inteira. Os links de atribuição permitem abrir a obra ou capítulo na fonte original.

## Publicar o site

O projeto agora pode servir o site e o intermediário juntos em um Web Service Node no Render. Use `node --check scripts/mangadex-server.mjs` como comando de build e `npm start` como comando de início. O servidor respeita `PORT`, escuta em `0.0.0.0` na hospedagem e oferece `/healthz` para verificação. `RENDER_EXTERNAL_URL`, fornecida pelo Render, identifica a origem HTTPS permitida. Nenhuma chave administrativa é necessária para o intermediário.

No site publicado dessa forma, o cliente usa `/mangadex` no mesmo endereço. A configuração `mangadexProxyUrl` continua disponível para outro backend. A alternativa de Edge Function abaixo só é necessária se você hospedar o frontend separadamente; nesse caso, preencha `mangadexProxyUrl` com a URL da função.

O servidor local não fica disponível para visitantes de outros computadores. Para publicar a integração, publique o intermediário no seu backend ou a Edge Function fornecida em:

- `supabase/functions/mangadex/index.ts`
- `supabase/functions/_shared/mangadex-proxy.mjs`

A função não foi implantada automaticamente nesta sessão. A configuração específica está em `supabase/config.toml`. Configure `ARK_ALLOWED_ORIGINS` com as origens HTTPS exatas do seu site, separadas por vírgulas, sem caminhos. Por padrão, só são permitidas origens locais conhecidas.

Para a função **mangadex**, o gateway precisa permitir leitura pública sem JWT, pois as tags de imagem não enviam o cabeçalho de sessão. A configuração é específica a esta função pública de consulta; não desabilite autenticação ou RLS do catálogo. A função não acessa seu banco ou Storage e não utiliza a chave `service_role`. Consulte a [configuração oficial de Edge Functions](https://supabase.com/docs/guides/functions/function-configuration).

O cliente usa `mangadexProxyUrl` em `config.js` quando preenchido. Em localhost, o padrão é `http://127.0.0.1:8787/mangadex`; no site publicado, o padrão é `/mangadex` na mesma origem. Só use endereços HTTPS em um site HTTPS. Para usar outro backend, configure a URL pública correta em `mangadexProxyUrl`.

## Progresso e vínculo com a obra

A edição escolhida e o progresso de leitura MangaDex ficam neste navegador, separados por conta e por obra. Não são escritos nas tabelas de capítulos enviados, cujas chaves estrangeiras se referem aos seus próprios arquivos. O progresso dos capítulos publicados pelo seu painel continua sincronizado pelo Supabase. A sincronização entre dispositivos para capítulos externos é uma etapa futura.

Nenhuma alteração SQL é necessária para esta integração.

## Verificar

```powershell
node --test --test-isolation=none tests/auth.test.cjs tests/cloud-reader.test.cjs tests/metadata.test.cjs tests/translation.test.cjs tests/mangadex.test.cjs
```

Os testes verificam restrições do intermediário, cache, paginação, pausa por limites da fonte, URLs das páginas e isolamento do progresso. O teste real desta implementação encontrou Solo Leveling, listou capítulos PT-BR e retornou capa e uma imagem de capítulo pelo servidor local. A disponibilidade da fonte pode mudar.
