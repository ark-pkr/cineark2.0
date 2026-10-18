# Configuração do Supabase — CINE ARK

## Situação atual

Os arquivos estão preparados localmente. Nenhum SQL foi executado no projeto remoto e o bucket ainda não foi criado por esta implementação. A chave pública foi centralizada em `config.js`; credenciais administrativas nunca devem ser incluídas nesse arquivo.

Conta administrativa solicitada: **mrogerio4578@gmail.com**. O endereço publicado do site ainda não foi informado.

Projeto novo conectado em `config.js`: `hhbnjeoasbekqqjfxeqh`. A consulta pública confirmou autenticação por e-mail habilitada, cadastro permitido e confirmação de e-mail exigida. A consulta do catálogo retornou `PGRST205`: a tabela ainda não está disponível na API. Nenhum SQL administrativo foi aplicado nesta sessão.

Para instalar o banco novo em uma única operação, execute **`setup-new-project.sql`** no [SQL Editor do projeto novo](https://supabase.com/dashboard/project/hhbnjeoasbekqqjfxeqh/sql/new). Ele reúne catálogo, permissões, capítulos, progresso e bucket privado. Depois, cadastre e confirme a conta administrativa e execute `set-administrator.sql`. A chave pública fornecida conecta o site, mas não autoriza criação de tabelas ou promoção de administradores.

## Aplicar ao projeto existente

### Se estiver criando outro projeto

Crie o projeto na sua conta Supabase. Nenhum projeto novo foi criado automaticamente por estes arquivos. Execute `create-catalog.sql` antes dos passos abaixo: ele cria a tabela base que já existia no projeto anterior.

Depois de criar o projeto, substitua apenas `supabaseUrl` e `supabaseAnonKey` em `config.js` pelos valores públicos do novo projeto (URL e chave publishable/anon). Não utilize `service_role`, secret key ou senha do banco no site. O projeto anterior e seus dados não são migrados automaticamente.

### Ordem das configurações

Conecte a integração Supabase à conta que administra o projeto usado em `config.js`. Confira o projeto antes de executar as alterações. Não crie outro projeto nem troque as chaves sem conferir onde o catálogo atual está salvo.

No SQL Editor, execute nesta ordem:

1. `reader-access.sql`: ativa RLS e substitui as políticas atuais de `itens_catalogo`. A leitura do catálogo continua pública; inserir, editar e excluir exige `app_metadata.role = admin`.
2. `chapters-storage.sql`: cria `ark_chapters`, `ark_chapter_pages`, `ark_reading_progress` e o bucket privado `ark-pages`. A coluna `work_id` usa o mesmo tipo do ID do catálogo. O limite configurado é 15 MiB por imagem. Leitores autenticados podem consultar capítulos publicados e suas páginas; somente administradores podem enviar ou excluir arquivos. Cada leitor só pode acessar o próprio progresso.
3. Cadastre **mrogerio4578@gmail.com** no aplicativo e confirme o e-mail. Se a conta já existe e está confirmada, use-a.
4. `set-administrator.sql`: promove apenas essa conta já confirmada. O script interrompe a operação caso ela não exista ou não esteja confirmada. Saia e entre novamente no aplicativo para renovar a sessão.
5. `verify-configuration.sql`: confere RLS, políticas, bucket privado e conta administrativa, sem alterar dados.

As migrações usam transações. Revise políticas existentes antes de aplicar: `reader-access.sql` substitui as do catálogo, enquanto as políticas do armazenamento são específicas ao bucket `ark-pages`. Se houver políticas antigas de armazenamento que liberem todos os buckets, elas também precisam ser revisadas no projeto conectado.

## Autenticação e endereço do site

Em **Authentication → Sign In / Providers → Email**, habilite o acesso por e-mail/senha e o cadastro de usuários. Mantenha a confirmação de e-mail habilitada.

Em **Authentication → URL Configuration**, configure o **Site URL** com o endereço publicado e permita a URL exata de retorno usada pelo aplicativo. Por padrão, o aplicativo usa o endereço da própria página, sem parâmetros ou fragmento. Isso mantém caminhos como `/cineark2.0/` e `/index.html` quando necessário. `config.js` permite definir `authRedirectUrl` explicitamente.

Para testes locais, adicione `http://localhost:8080/` e, se abrir o arquivo por esse caminho, `http://localhost:8080/index.html` aos redirecionamentos permitidos. A URL de produção será configurada quando for informada. Não use o e-mail como endereço de retorno.

O Supabase exige que o retorno esteja na lista de URLs permitidas. Consulte a [documentação oficial de redirecionamentos](https://supabase.com/docs/guides/auth/redirect-urls) e [configuração de e-mail/senha](https://supabase.com/docs/guides/auth/passwords).

## Validar

Da pasta do projeto, execute `node scripts/check-supabase.cjs`. O comando usa apenas a chave pública, consulta a disponibilidade da autenticação e do catálogo e não imprime chaves ou dados das obras. O resultado de conectividade não comprova as permissões de escrita.

No SQL Editor, execute `verify-configuration.sql`. Confira quatro tabelas com RLS habilitado, bucket `ark-pages` com `public = false`, e a conta administrativa confirmada com papel `admin`.

Validação funcional após aplicar:

- Cadastro e confirmação de uma conta de leitor; entrada e saída.
- Conta administrativa vê o painel e consegue gerenciar obras.
- Leitor não possui comandos administrativos e tentativas de escrita direta no catálogo são negadas pelo banco.
- Páginas do bucket privado só podem ser lidas conforme as políticas. O futuro cliente online usará URLs assinadas, conforme a [documentação oficial de buckets privados](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Integração do leitor

O frontend agora envia capítulos para essas tabelas e o bucket privado, abre páginas por URLs assinadas e sincroniza o progresso por conta. A instalação SQL existente já contém os recursos necessários; não é preciso reaplicá-la após atualizar o frontend.

Capítulos antigos do navegador continuam no IndexedDB e podem ser publicados explicitamente pelo administrador, na obra com o mesmo ID. Não são enviados nem apagados automaticamente. Valide o envio e a leitura com uma sessão autenticada antes de divulgar a biblioteca.
