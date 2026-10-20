# Navegação e manutenção da leitura

- Busca, gênero, tipo, idioma, lista pessoal, ordenação, visualização e quantidade de resultados ficam guardados na sessão do navegador, separados por conta. Ao voltar da obra, o catálogo recupera esses filtros e a altura da rolagem. Links diretos de obras não são desviados para uma posição do catálogo.
- A lista de capítulos dentro do leitor abre já expandida até o capítulo atual e posiciona o foco nele. A busca manual continua disponível.
- A última remoção de um momento oferece **Desfazer remoção de momento**. A restauração conserva o identificador, o nome e o ponto de leitura. Essa opção permanece até outra remoção, troca de conta ou recarregamento; falhas no servidor preservam a opção de tentar novamente.
- O painel de relatos permite combinar status, obra, número de capítulo e categoria. A busca é aplicada no servidor antes da paginação; capítulos decimais aceitam vírgula no formulário.

## Correções de capítulos

`supabase/sql/chapter-content-revisions.sql` adiciona versões de conteúdo. Alterar páginas, título ou número atualiza a versão; uma atualização de páginas sem mudança real não o faz. Uma operação em lote conta como uma revisão, sem gerar uma atualização por imagem.

A leitura concluída guarda a versão vista. Quando a versão do capítulo do catálogo é mais nova, a lista mostra **Corrigido após sua leitura**. Concluir a nova versão atualiza esse registro. Contas conectadas sincronizam o histórico privado; visitantes guardam as versões concluídas neste navegador. Dados antigos começam na versão 1, sem inventar correções anteriores.

O aviso cobre capítulos do catálogo e alterações em seus registros de páginas. Não verifica arquivos binários sobrescritos diretamente no Storage sem alterar os registros, nem presume correções em serviços externos. Os marcadores de momentos continuam vinculados ao índice da página; uma correção que reorganize páginas pode mudar a cena nesse índice.
