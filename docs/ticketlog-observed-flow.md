# Fluxo observado Sou Log+ / Ticket Log

Base: video local fornecido em 2026-07-27 pelo usuario do projeto. Este documento descreve evidencias visuais do fluxo e nao substitui homologacao, termos de uso ou documentacao oficial da Ticket Log.

## Fatos observados

- O login do Sou Log+ pode apresentar reCAPTCHA.
- Apos usuario e senha, pode haver validacao por codigo enviado ao celular.
- A plataforma pode perguntar se o Sou Log+ deve ser considerado confiavel no navegador atual.
- A pagina de veiculos esta em `/register/fleet/vehicle/list` e exibe o titulo `Meus veiculos / equipamentos`.
- A busca aceita placa no campo de pesquisa da lista.
- A alteracao de limite abre uma pagina `legacy` com o titulo `Alteracao de Limite`.
- A tela `legacy` carrega dentro de um iframe de `legacy-soulog.ticketlog.com.br`; os campos nao ficam no DOM principal.
- O formulario de limite possui:
  - campo `Valor para alteracao`;
  - radio `Adicionar o valor ao limite atual`;
  - radio `Somente para o periodo`;
  - campo `Motivo da alteracao`;
  - tabela com uma linha por veiculo;
  - checkbox na linha da placa;
  - botao final `Alterar`.
- Durante a alteracao, o botao pode mudar para estado `Aguarde...`.
- A EVA abre como widget lateral na pagina inicial.
- O fluxo da EVA observado foi:
  - selecionar `Transacoes`;
  - selecionar `Liberar abastecimento (restricao)`;
  - informar a placa;
  - aguardar resposta da assistente.
- Uma resposta de sucesso observada na EVA foi: `Pronto! Fiz a liberacao da restricao...`.
- O detalhe do veiculo mostra placa, modelo, status do cartao, limite total e proximo saldo disponivel.

## Regras de automacao derivadas

- A automacao nao deve tentar resolver reCAPTCHA, codigo por celular, MFA ou escolha de dispositivo confiavel.
- O login real deve ser feito por sessao persistente previamente autorizada, com intervencao humana quando houver desafio.
- O worker em producao deve parar em `FALHA_MANUAL` se a plataforma exigir uma confirmacao humana inesperada.
- A ordem obrigatoria e: buscar placa, abrir detalhe, verificar status, desbloquear se necessario, alterar limite, confirmar alteracao de limite, abrir EVA, liberar abastecimento por restricao.
- A EVA nao deve ser aberta antes da confirmacao da alteracao de limite.
- A selecao da placa no formulario de limite deve ocorrer pela linha da tabela que contem exatamente a placa normalizada.
- A automacao deve aguardar o iframe legado conter `Valor para alteracao` e `Adicionar o valor ao limite atual` antes de preencher qualquer campo.
- A etapa de limite so pode ser marcada como concluida depois de uma mensagem clara ou reconciliacao visual do novo limite.
- Se o processo cair apos clicar em `Alterar` e antes de confirmar o resultado, a solicitacao deve ir para `RESULTADO_INDETERMINADO`.
- Se a alteracao de limite for confirmada e a EVA falhar, o sistema nao deve repetir a alteracao. Deve retomar somente a EVA.
- A EVA deve aceitar como sucesso apenas texto/estado final explicito, por exemplo `Fiz a liberacao da restricao`.

## Pontos ainda nao provados

- Se ha API oficial disponivel para a empresa.
- Se o fluxo observado e identico para todos os grupos de restricao.
- Se veiculos bloqueados sempre exibem o mesmo botao e a mesma confirmacao de desbloqueio.
- Se a pagina `legacy` mantem atributos acessiveis estaveis para Playwright.
- Se a EVA pode variar textos, opcoes ou ordem de menu.
- Se a sessao confiavel permanece valida em ambiente Railway/headless.
- Se o uso de automacao por navegador e permitido nos termos aplicaveis da Ticket Log.

## Implicacoes para homologacao

- A primeira validacao deve ser sempre `validate:browser`, em modo visivel, com placa de teste.
- O modo `browser` do worker so deve ser habilitado com autorizacao formal e processo manual de contingencia.
- Evidencias devem mascarar placa, cartao, saldo e dados pessoais quando forem persistidas fora do navegador.
