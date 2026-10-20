# Verificação antes de publicar

Execute `npm run verify` para rodar os testes e gerar o pacote de produção. Publique um conjunto de alterações por vez para evitar builds desnecessários no Netlify.

Na revisão manual em PC e celular:

- Buscar por título em português, aplicar tipo/gênero/idioma juntos e limpar os filtros. Conferir a mensagem de busca vazia.
- Abrir uma obra com capítulos e outra sem capítulos; conferir sinopse, ação principal e ponto salvo.
- Ler como visitante, avançar, recarregar e confirmar o capítulo, a página e a posição. Sair voluntariamente e recarregar para confirmar que o leitor permanece fechado.
- Entrar por e-mail e Google, cadastrar uma conta e recuperar senha; conferir isolamento de progresso entre contas.
- Abrir a lista no leitor, localizar o capítulo atual e navegar para o anterior/próximo. Conferir controles recolhidos, teclado e foco visível.
- Simular falha de rede e testar recuperação de páginas sem perder o ponto de leitura. Conferir a preferência de economia de dados.
- Concluir um capítulo, reagir, trocar e remover a reação. Conferir os totais após recarregar.
- Desativar animações e conferir a leitura sem efeitos. Conferir botões e configurações com uma mão no celular.

Depois do deploy, confirmar o estado Published no Netlify e a nova versão do service worker no domínio público. Verificar novamente um capítulo como visitante. Se a revisão visual não estiver disponível, registrar essa limitação; testes automáticos não substituem a revisão manual.
