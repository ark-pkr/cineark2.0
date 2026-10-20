# Medição local de desempenho

Abra o site no celular (ou a emulação móvel do DevTools), recarregue e abra um capítulo. No console, execute `ArkUX.performance()`.

- `fcpMs`: tempo até o primeiro conteúdo aparecer.
- `lcpMs`: tempo até o maior conteúdo visível, atualizado pelo navegador.
- `cls`: maior janela de instabilidade visual sem interação recente.
- `chapterOpenMs`: tempo para obter os endereços das páginas e preparar o leitor.
- `chapterFirstImageMs`: tempo até a primeira imagem do capítulo informar carregamento.
- `domReadyMs` e `loadMs`: tempos de navegação do documento.

Os valores são locais, em milissegundos exceto CLS. `null` significa que a medição ainda não existe ou não é suportada. Nenhum dado é enviado, e as medições não contêm títulos, contas, URLs de imagens ou conteúdo dos capítulos. Não representam resultados coletados de todos os leitores.

Compare três aberturas com cache vazio e três com cache aquecido, usando o mesmo celular e rede. Registre o valor mediano e teste também uma conexão lenta. A prévia das configurações é ilustrativa; a página real continua sendo a referência para avaliar legibilidade.
