# Publicação por ZIP

Na obra, abra **Gerenciar capítulos → Publicar capítulos por ZIP → Escolher ZIP**. Selecione o arquivo da obra, confira os capítulos identificados e marque a confirmação de revisão. Nenhum conteúdo é enviado ao escolher o arquivo. O envio só começa em **Publicar selecionados**.

O importador encontra pastas como `Capitulo_02`, `Capítulo 26.5`, `Cap 12`, `Chapter 10` ou `03`, inclusive dentro de outras pastas. Cada pasta com imagens é um capítulo separado. Quando o número não é reconhecido, preencha-o manualmente. Números repetidos no lote precisam ser corrigidos ou desmarcados. As imagens são ordenadas numericamente pelo nome; a revisão permite alterar essa ordem e abrir uma prévia de uma imagem por vez. Arquivos que não são imagens são ignorados.

O ZIP permanece no computador. O índice é lido separadamente, e as imagens são descompactadas, verificadas e enviadas uma a uma diretamente ao armazenamento já utilizado pelo leitor. O aplicativo só torna cada capítulo público depois de armazenar todas as imagens e metadados. As permissões administrativas existentes continuam em vigor. Não há nova tabela, chave ou política no banco.

Durante o envio, mantenha a aba aberta. O botão de pausa conclui o capítulo em andamento antes de parar. Retome com “Publicar selecionados”; capítulos publicados nesta sessão não são enviados novamente. “Reenviar somente falhas” tenta apenas os capítulos que falharam. Antes de cada execução, o aplicativo consulta os números já existentes, inclusive rascunhos e lixeira, sem substituí-los. Se uma falha deixar um rascunho, confira-o antes de reenviar. Recarregar ou fechar a aba exige selecionar o ZIP de novo; os capítulos já publicados serão detectados na próxima execução.

Formatos: ZIP normal, sem senha, com compressão Deflate ou sem compressão; imagens JPG, PNG, WebP, AVIF e GIF, até 15 MiB cada; até 1.000 imagens por capítulo. ZIP64 e arquivos divididos em volumes são recusados com uma mensagem. Use Chrome/Edge atualizados com suporte a `DecompressionStream('deflate-raw')`; outros navegadores compatíveis também podem ser usados. Para ZIP64, divida a coleção em ZIPs menores.

Verificação local sem publicar:

```powershell
node scripts/check-chapter-zip.cjs "C:\caminho\obra.zip"
npm run verify
```

O verificador lê os nomes, agrupa os capítulos e verifica a descompactação/CRC da primeira e da última imagem, sem extrair arquivos para disco. O arquivo fornecido “NECROMANTE REI DOS MORTOS.zip” foi reconhecido com 3.286 imagens e 101 capítulos, incluindo os extras 26.5 e 35.5. Essa verificação não publica conteúdo nem substitui o teste de envio com uma sessão administrativa.

Referências: [descompressão nativa](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream/DecompressionStream), [envio padrão ao armazenamento](https://supabase.com/docs/guides/storage/uploads/standard-uploads).
