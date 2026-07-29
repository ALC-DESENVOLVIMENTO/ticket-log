# Estacao operacional Ticket Log

## Objetivo

A estacao mantem um Chromium persistente no worker e publica a tela por noVNC.
Quando a Edenred exigir login, OTP, SMS, trusted device ou reCAPTCHA, um
aprovador ou administrador assume a estacao no painel web. A automacao aguarda
o desafio ser concluido e continua usando o mesmo perfil do navegador.

## Configuracao do worker no Railway

O servico `worker-playwright` precisa de:

- dominio publico gerado no Railway;
- volume persistente montado em `/data`;
- porta fornecida pela variavel `PORT` do Railway;
- no maximo uma replica enquanto usar um unico perfil persistente.

Variaveis:

```text
TICKETLOG_PROVIDER_MODE=browser
TICKETLOG_REAL_EXECUTION=true
TICKETLOG_HEADLESS=false
TICKETLOG_STATION_MODE=true
TICKETLOG_ALLOW_MANUAL_LOGIN=true
TICKETLOG_MANUAL_LOGIN_CONTINUE=auto
TICKETLOG_MANUAL_LOGIN_TIMEOUT_MS=900000
TICKETLOG_USER_DATA_DIR=/data/ticketlog-session/profile
TICKETLOG_SESSION_STORAGE_PATH=/data/ticketlog-session/storage-state.json
TICKETLOG_OPERATOR_ACCESS_TOKEN=<segredo base64url ou hex com 32+ caracteres>
TICKETLOG_OPERATOR_PASSWORD=<segredo forte e exclusivo>
WORKER_CONCURRENCY=1
LIMIT_JOB_ATTEMPTS=3
LIMIT_RETRY_DELAY_MS=15000
```

`TICKETLOG_OPERATOR_URL` e opcional. Quando ausente, o worker usa
`RAILWAY_PUBLIC_DOMAIN` para publicar `/vnc.html`.

`TICKETLOG_OPERATOR_ACCESS_TOKEN` deve ser configurado com o mesmo valor nos
servicos `api` e `worker-playwright`. O token nao e persistido no banco.

## Operacao

1. O worker envia heartbeat e estado da sessao ao PostgreSQL.
2. A aba Operacao atualiza o estado a cada dez segundos.
3. Um aprovador ou administrador clica em `Assumir estacao`.
4. O painel libera a tela somente para esse usuario por quinze minutos.
5. O painel disponibiliza a senha VNC ao operador que possui o claim ativo.
6. O operador copia a senha, conecta ao navegador e conclui apenas o desafio da Edenred.
7. Se o job ainda estiver aguardando, ele continua automaticamente.
8. Se a solicitacao ja estiver em `FALHA_MANUAL`, o operador usa
   `Retomar solicitacao`.
9. O operador encerra o acesso ao terminar.

Falhas transitorias de interface sao retomadas automaticamente pela fila. O
backoff padrao e de 15 segundos e cresce exponencialmente. Quando o limite ja
foi confirmado, as novas tentativas executam somente a etapa pendente da EVA.
Depois da ultima tentativa, a solicitacao e encerrada em falha manual para nao
bloquear uma nova solicitacao do usuario.

## Controles

- a URL da estacao nao e retornada a usuarios sem claim ativo;
- somente perfis `APROVADOR` e `ADMINISTRADOR` podem acessar;
- claim e liberacao geram eventos de auditoria;
- o heartbeat diferencia worker online de estado antigo;
- o perfil do Chromium fica no volume persistente;
- nginx exige um token de acesso antes de expor o noVNC;
- a senha operacional fica nas variaveis protegidas do Railway e so e retornada
  pela API ao operador com claim ativo, com resposta `Cache-Control: no-store`;
- a senha operacional nao e persistida no banco, logs ou eventos de auditoria;
- a estacao deve permanecer com uma replica para evitar corrupcao do perfil.

Esta solucao nao contorna MFA, CAPTCHA ou antifraude. Ela fornece uma forma
legitima de um operador autorizado concluir o desafio na propria sessao do
worker.
