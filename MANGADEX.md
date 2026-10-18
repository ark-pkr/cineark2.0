# MangaDex no CINE ARK

## Usar no computador

Na pasta do projeto, execute:

```powershell
node scripts/mangadex-server.mjs
```

Mantenha o terminal aberto. O servidor escuta apenas em `127.0.0.1:8787`. Você pode continuar no Live Server em `http://127.0.0.1:5500` ou abrir `http://127.0.0.1:8787`, que serve o mesmo site. Dados locais do navegador são separados por endereço; mantenha o endereço anterior se precisar das cópias locais antigas.

Entre na sua conta, abra uma obra e escolha a aba **MangaDex**. A busca começa com o título da obra. Selecione a edição correta, confira o idioma e abra um capítulo. O padrão é **Português (Brasil)**, com opções de português de Portugal e inglês. Não existe tradução automática das imagens: a fonte precisa disponibilizar o capítulo no idioma escolhido.

Os resultados mostram edições, derivados e nomes alternativos. O programa não escolhe automaticamente a primeira edição. Ao selecionar a edição e o idioma, a lista completa é consultada automaticamente em blocos de até 100 registros. A busca mostra progresso, permite parar e pode continuar do ponto interrompido. Requisições são sequenciais e respeitam os limites da fonte; erros mantêm os capítulos já encontrados. A API limita a janela a 10.000 registros; se esse teto impedir a consulta completa, o site avisa. Capítulos externos, vazios ou marcados como indisponíveis não são incorporados ao leitor. Restrições de acesso da fonte são apresentadas ao usuário, sem tentativas de contorná-las.

O leitor tem lista de capítulos com busca por número, título e grupo, salto de página, largura ajustável e modo foco. As listas extensas são exibidas por partes para preservar o desempenho, embora os metadados já tenham sido consultados. A navegação sequencial prefere o mesmo grupo e evita repetir versões do mesmo número/volume; todas as versões continuam selecionáveis na lista. O modo foco esconde os controles e as runas, com botão para restaurar e atalho Escape. Home/End vão à primeira/última página; PageUp/PageDown percorrem páginas. A lista completa não cria capítulos ausentes nem muda o idioma escolhido.

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

A edição lida, o idioma, o capítulo e a página MangaDex são sincronizados pela conta na tabela `ark_mangadex_progress`. Uma cópia local permanece disponível quando a rede falha. O progresso local das versões anteriores é enviado após a primeira conexão; registros mais antigos não substituem os mais recentes no banco. A seleção sem leitura ainda fica neste navegador; ao usar outro dispositivo, a edição do último capítulo lido é recuperada automaticamente.

Para ativar a sincronização no projeto existente, execute `supabase/mangadex-progress.sql` no SQL Editor. O script cria uma tabela separada dos capítulos enviados, com RLS e políticas que permitem ao leitor acessar somente seu próprio progresso. A tabela não foi criada automaticamente nesta sessão, que não possui acesso administrativo ao Supabase. A consulta final deve retornar quatro políticas com `rls_enabled = true`.

Depois de executar o script, recarregue o site e leia algumas páginas. O indicador deve mostrar **Progresso salvo na conta**. Entre na mesma conta em outro navegador/dispositivo, abra a obra e use **MangaDex → Continuar no MangaDex**. Sem a tabela, o site preserva o progresso local e mostra a configuração pendente. Falhas de rede são tentadas novamente ao reconectar ou reabrir a obra.

## Verificar

```powershell
node --test --test-isolation=none tests/auth.test.cjs tests/cloud-reader.test.cjs tests/metadata.test.cjs tests/translation.test.cjs tests/mangadex.test.cjs
```

Os testes verificam restrições do intermediário, cache, paginação, pausa por limites da fonte, URLs das páginas e isolamento do progresso. O teste real desta implementação encontrou Solo Leveling, listou capítulos PT-BR e retornou capa e uma imagem de capítulo pelo servidor local. A disponibilidade da fonte pode mudar.
