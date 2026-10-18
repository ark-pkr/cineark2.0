# CINE ARK — leitor

O catálogo, os capítulos publicados e o progresso por conta usam o Supabase configurado em `config.js`. As páginas ficam no bucket privado `ark-pages`; o leitor solicita URLs temporárias com a sessão do usuário. O progresso é salvo também neste navegador para tentar sincronizar novamente após uma falha de conexão. A exportação do catálogo inclui apenas as obras; preserve os arquivos originais das páginas.

## Usar

Para a integração de capítulos do MangaDex, consulte [MANGADEX.md](MANGADEX.md). O comando `node scripts/mangadex-server.mjs` serve o site e o intermediário de imagens local em `http://127.0.0.1:8787`. A aba MangaDex já está integrada ao leitor; o intermediário precisa estar em execução.

Sirva a pasta com `python -m http.server 8080` e acesse `http://localhost:8080`. As bibliotecas carregadas por CDN precisam de internet.

1. Use **Criar conta** para cadastrar um leitor ou **Entrar** para acessar uma conta existente. O Supabase pode exigir confirmação do e-mail.
2. Administradores veem **Painel administrativo**, onde podem cadastrar e editar obras Mangá, Manhwa ou Manhua.
3. Toque em **Ler / Capítulos** na capa.
4. Como administrador, informe o número do capítulo e selecione as imagens autorizadas (até 15 MiB por imagem). Confira a ordem por nome e use **Enviar e publicar capítulo**. Ele só é publicado depois do envio das imagens e dos registros das páginas.
5. Abra o capítulo e escolha rolagem vertical ou página por página, com direção configurável.
6. **Continuar lendo** restaura a última página. No modo paginado, as setas seguem a direção escolhida; Escape volta aos capítulos.

Envio e exclusão aparecem apenas para administradores; leitores acessam capítulos publicados. **Continuar lendo** recupera o progresso da conta em outro dispositivo. Quando a rede falha, o progresso pendente permanece local e é reenviado ao reconectar ou entrar novamente. Capítulos online precisam de conexão para carregar imagens; esta versão não oferece download offline.

Os capítulos antigos do IndexedDB não são apagados. Na obra correspondente, o administrador encontra **Capítulos antigos deste dispositivo**, com opções de leitura, publicação online e exclusão apenas da cópia local. A publicação não substitui números já usados, nem remove o original local. Se a obra foi recriada em outro projeto com outro ID, será necessário reenviar suas imagens pela obra nova.

Se um envio falhar, o aplicativo tenta remover os arquivos enviados e o rascunho. Quando a limpeza também falha, o administrador pode atualizar os capítulos e excluir o rascunho antes de reenviar. Exclusões online retiram o capítulo de publicação antes de remover arquivos e registros; se interrompidas, podem ser repetidas pelo painel.

## Configurar contas e administração

Execute `supabase/reader-access.sql` no SQL Editor do projeto existente para proteger a escrita do catálogo. O script substitui as políticas atuais dessa tabela: leitura pública e escrita somente por administradores. O arquivo foi preparado localmente; ele não é aplicado automaticamente ao projeto remoto.

Cadastre sua conta normalmente e execute separadamente o exemplo comentado ao final do SQL, substituindo `SEU_EMAIL_ADMIN` pelo seu e-mail. Isso define `app_metadata.role = admin`, que somente o servidor deve alterar. Saia e entre novamente. Contas criadas pelo formulário não recebem esse papel; `user_metadata` não concede administração.

No Supabase Authentication, habilite cadastro por e-mail/senha e configure a URL do site e os redirecionamentos de confirmação para o endereço publicado. A proteção efetiva do catálogo depende da aplicação das políticas SQL. O aplicativo não possui credenciais administrativas para executar essa configuração remota.

O roteiro completo, a configuração do administrador solicitado e a ordem das migrações estão em [supabase/CONFIGURACAO.md](supabase/CONFIGURACAO.md). A configuração pública está em `config.js`. Para verificar conectividade sem alterar dados: `node scripts/check-supabase.cjs`.

## Validação

### Capas e sinopses automáticas

O cadastro pesquisa a [API AniList](https://docs.anilist.co/guide/graphql/) como fonte principal e usa a [Jikan](https://docs.api.jikan.moe/) como alternativa em caso de falha ou ausência de resultados. Cada fonte tem limite de quatro segundos, independente do limite global. Digite pelo menos três caracteres do título e selecione a obra: capa, sinopse, tipo e total de capítulos são preenchidos. Revise e salve. Obras vinculadas ao MyAnimeList permitem **Atualizar dados da API** pelo identificador salvo; a consulta AniList usa `idMal`, preservando a compatibilidade com obras cadastradas pela Jikan. A sinopse é exibida na página de capítulos.

No banco já instalado, execute **`supabase/catalog-metadata.sql`** uma vez para adicionar `synopsis` e `mal_id`, preservando dados e permissões. A chave pública não permite executar essa alteração. Se os campos ainda não existirem, o cadastro informa a atualização necessária e mantém o formulário preenchido.

Ao selecionar uma obra, a sinopse importada é traduzida de inglês para português brasileiro pelo MyMemory. O texto é enviado em trechos pequenos, com cache local de traduções concluídas para evitar consultas repetidas. O formulário mostra o progresso e aguarda o término antes de salvar. O serviço tem limites de uso: se a tradução falhar ou atingir a cota, o original é mantido por inteiro e uma mensagem permite tentar novamente ou editar manualmente. Edições manuais e troca de obra cancelam a tradução pendente.

O botão **Traduzir sinopse para português** permite traduzir sinopses existentes no editor. A busca de obras mantém atraso, cancelamento de respostas antigas e cache por dez minutos. Erros por campos ausentes no banco são exibidos no próprio formulário, com SQL e link para o editor, mantendo os dados preenchidos. Os comandos necessários são os de `supabase/catalog-metadata.sql`; não é preciso reinstalar as tabelas de capítulos.

O leitor online usa as tabelas e políticas de `supabase/chapters-storage.sql`, já incluídas em `setup-new-project.sql`. Não é necessário reaplicar a instalação para esta atualização do frontend.

Execute `node --test --test-isolation=none tests/auth.test.cjs tests/cloud-reader.test.cjs tests/metadata.test.cjs tests/translation.test.cjs`. Os testes usam um serviço simulado e verificam publicação, limpeza após falhas, URLs de páginas, paginação, permissões na interface, troca de contas e sincronização do progresso. A verificação pública de conexão é `node scripts/check-supabase.cjs`.

Para validar o fluxo real com a conta autenticada: publique um capítulo pequeno, abra-o como leitor, avance algumas páginas e confira **Continuar lendo** com a mesma conta em outro dispositivo. Nenhuma senha ou sessão de usuário está incluída nos testes locais.
