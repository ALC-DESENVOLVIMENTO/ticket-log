# Validacao controlada Sou Log+ / Ticket Log

Este procedimento valida a interface da Ticket Log sem executar alteracao real de limite e sem enviar liberacao pela EVA.

## O que o validador faz

- Abre a sessao da Ticket Log/Sou Log+ com Playwright.
- Entra na pagina de veiculos configurada em `TICKETLOG_VEHICLE_LIST_URL`.
- Pesquisa a placa configurada em `TICKETLOG_VALIDATE_PLATE`.
- Confirma que existe exatamente um resultado.
- Abre o detalhe do veiculo.
- Tenta identificar status e limite atual.
- Abre o formulario de `Alterar limite` e valida campos obrigatorios.
- Abre a EVA e valida o fluxo `Transacoes` > `Liberar abastecimento (restricao)`.
- Preenche a placa na EVA, mas nao envia.
- Gera um relatorio JSON em `artifacts/ticketlog-validation`.

## O que o validador nao faz

- Nao clica no botao final `Alterar`.
- Nao confirma desbloqueio.
- Nao envia solicitacao na EVA.
- Nao tenta contornar CAPTCHA, MFA ou bloqueio antifraude.
- Nao grava senha, token ou cookie no relatorio.

## Variaveis necessarias

Configure localmente ou no Railway, nunca no chat:

```env
TICKETLOG_LOGIN_URL=https://URL-DE-LOGIN-DA-TICKETLOG
TICKETLOG_VEHICLE_LIST_URL=https://plataforma.ticketlog.com.br/register/fleet/vehicle/list
TICKETLOG_VALIDATE_PLATE=ABC1D23
TICKETLOG_SESSION_STORAGE_PATH=.secrets/ticketlog-storage.json
TICKETLOG_HEADLESS=false
TICKETLOG_KEEP_BROWSER_OPEN=true
TICKETLOG_ALLOW_MANUAL_LOGIN=true
TICKETLOG_MANUAL_LOGIN_TIMEOUT_MS=600000
```

Se a conta puder fazer login sem etapa humana:

```env
TICKETLOG_USERNAME=usuario-corporativo
TICKETLOG_PASSWORD=senha-corporativa
```

Se houver MFA, CAPTCHA ou confirmacao corporativa, use `TICKETLOG_ALLOW_MANUAL_LOGIN=true`. O navegador abre, voce conclui o login manualmente, e a validacao continua quando a pagina de veiculos ficar acessivel.

## Como executar

```powershell
npm.cmd run build -w @ticketlog/ticketlog
$env:TICKETLOG_VALIDATE_PLATE="ABC1D23"
npm.cmd run validate:browser -w @ticketlog/ticketlog
```

Com `TICKETLOG_KEEP_BROWSER_OPEN=true`, o navegador fica aberto ao final da validacao. Pressione Enter no terminal para fechar.

Com `TICKETLOG_ALLOW_MANUAL_LOGIN=true`, nao feche a janela depois do login. Deixe o Playwright continuar; ele navegara para a lista de veiculos automaticamente.

Opcionalmente defina um caminho de saida:

```powershell
$env:TICKETLOG_VALIDATION_OUTPUT_PATH="artifacts/ticketlog-validation/homologacao.json"
```

## Criterios de aceite da validacao

- `AUTHENTICATE` passou ou parou corretamente em intervencao humana.
- `OPEN_VEHICLE_LIST` passou.
- `SEARCH_PLATE` encontrou exatamente um veiculo.
- `OPEN_PLATE` abriu o detalhe da placa correta.
- `READ_STATUS` identificou status ou registrou incerteza sem continuar com acao real.
- `READ_CURRENT_LIMIT` encontrou o limite atual ou registrou ausencia do campo.
- `INSPECT_CHANGE_LIMIT_FORM` encontrou todos os campos necessarios.
- `INSPECT_EVA_FLOW` encontrou o fluxo da EVA sem clicar em enviar.

Somente depois disso o modo `TICKETLOG_PROVIDER_MODE=browser` deve ser testado com uma placa de homologacao e valor autorizado pela empresa.
