# Correções de áudio, simulação e importação

- `/user/me` informa recursos de mídia conforme o mesmo teste de 7 dias usado pelo servidor. Contas vencidas ou com pagamento pendente não são liberadas pela interface.
- Áudio por arquivo: MP3, M4A, MP4, WAV, WebM, OGG/OPUS, até 20 MB. OGG/OPUS passa por conversão restrita ao demuxer OGG, em diretório privado e temporário, removido inclusive em falhas. O cliente respeita o MIME real da gravação, limita gravação a 5 minutos, encerra o microfone antes da rede e preserva o rascunho.
- Uploads renovam a sessão uma única vez quando o servidor informa token expirado, sem reenvio automático após falhas de processamento. Cada instância processa no máximo duas mídias/importações simultâneas. Cada conta processa uma importação/áudio por vez, com limite de 12 envios em 15 minutos por instância. Em múltiplas réplicas, migrar esse controle para armazenamento compartilhado.
- Simulações pedem área, serviço e dificuldade, aproveitando o perfil. O usuário pode trocar esses dados a cada exercício. O modelo recebe instrução de interpretar o cliente e avaliar ao comando `encerrar simulação`.
- ZIP do WhatsApp: até 20 MB, 200 entradas, 20 MB por entrada e 60 MB descompactados; sem extração de caminhos no disco, sem links, criptografia ou arquivos de mesmo nome. Exatamente um TXT por conversa. Até 12 mídias processadas sequencialmente, com verificação de prazo de 3 minutos entre chamadas; uma chamada iniciada pode terminar depois desse prazo. Áudios são transcritos; imagens JPEG/PNG/WebP são analisadas. MP4 fornece apenas áudio. Formatos sem suporte, falhas e limites aparecem no resumo. Arquivos e trechos sem referência no TXT não recebem data/remetente inventados. O conteúdo textual salvo é limitado a 50 mil caracteres com aviso explícito de truncamento.
- O importador salva somente texto processado na tabela `uploads`, associado ao usuário autenticado. O chat mantém seu filtro de propriedade ao recuperar esse texto. O ZIP e as mídias originais não são gravados no storage público.
- O contador indica a data de término do teste e mensagens sem limite enquanto o teste está ativo. Fora do teste mostra uso do mês; contadores de mês anterior aparecem zerados.
- “Aulas e gravações” consulta link HTTPS configurado em `AULAS_GRAVACAO_URL`. Sem link, informa que a gravação não foi disponibilizada e oferece o manual. Não há vídeo fictício nem URL inventada.

## Validação

`npm test` cobre acesso por plano e teste, isolamento de uploads, gravação MP4, erro de rede, permissão de microfone, personalização da simulação, conversão OGG real, limpeza dos temporários, importação com falhas parciais e rejeição de ZIP malicioso.

A transcrição e a análise externas são simuladas nos testes de integração para não enviar conversas pessoais nem gerar custos. Antes de declarar a correção validada no dispositivo de uma pessoa, testar um áudio e um ZIP fictícios no navegador utilizado por ela. A aceitação de cartões exige a conta de pagamentos habilitada pelo provedor; a bateria local não comprova uma cobrança real.
