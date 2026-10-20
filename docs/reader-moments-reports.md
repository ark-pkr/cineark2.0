# Momentos favoritos e relatos

No leitor, **Momentos** abre o formulário para guardar o ponto atual com um nome opcional. O menu principal também oferece **Meus momentos**. A lista mostra a obra e o capítulo, sem expor o número da página na retomada. **Voltar ao momento** restaura capítulo, página e deslocamento interno. **Remover** exclui somente o marcador, preservando obra e progresso.

Visitantes usam armazenamento local. Contas conectadas usam a tabela privada `ark_reader_moments`, com cache por conta e limite de 200 momentos na interface. Não há importação automática entre visitante e conta. Existe um marcador por página em cada edição; URLs assinadas e imagens não são guardadas nos favoritos. Obras ou capítulos removidos exibem indisponibilidade ao tentar reabrir.

**Relatar problema** captura o ponto em que o formulário foi aberto. Aceita página ausente/imagem com falha, ordem incorreta, capítulo incorreto ou outro problema, com descrição opcional de até 500 caracteres. Visitantes podem enviar sem login. O envio não grava identidade do leitor, e o formulário só confirma sucesso após resposta do servidor.

Em **Painel administrativo → Relatos dos leitores**, o administrador consulta pendentes e resolvidos, identifica a página afetada e marca como resolvido ou reabre o relato. A permissão depende de `app_metadata.role=admin`. Leitores não podem consultar os relatos ou alterar seu status. O cadastro de um relato não envia e-mail, notificações externas ou mensagens para outras pessoas.

O esquema e as políticas estão em `supabase/sql/reader-moments-reports.sql`. Marcadores são protegidos por proprietário. Relatos não têm leitura pública; visitantes recebem somente permissão de inserção dos campos do formulário. Apenas administradores têm leitura e atualização do status. Descrições são renderizadas como texto.
