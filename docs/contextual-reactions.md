# Reações por obra e capítulo

No cadastro ou edição de uma obra, **Reações desta obra** permite usar o gênero automaticamente ou escolher ação/fantasia, romance, terror/suspense e comédia. Os três textos podem ser personalizados; apagar um texto restaura o padrão. Os tipos semânticos continuam estáveis para preservar votos existentes. Uma reação antiga fora do perfil atual permanece disponível para seu autor trocar ou remover.

As contagens representam votos reais de contas conectadas, separados por obra, edição e capítulo. Cada conta tem um voto, que pode trocar ou remover. Visitantes podem reagir sem login, com armazenamento apenas no navegador; esses votos não entram na contagem pública.

`supabase/sql/contextual-reactions.sql` adiciona a configuração ao catálogo e amplia os tipos aceitos, preservando os votos anteriores. A tabela pública de totais não contém identificadores de leitores e aceita apenas leitura. Um gatilho privado atualiza os totais na mesma transação da gravação. Os votos individuais continuam protegidos por suas políticas de propriedade.

Não há contagens simuladas, consulta em cada rolagem ou assinatura Realtime. Os totais são consultados ao concluir o capítulo, ao tentar novamente e após salvar uma reação na conta. Falhas de consulta são exibidas como indisponibilidade, sem fingir uma contagem zero. A animação respeita movimento reduzido e a preferência de animações do site.
