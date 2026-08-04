# Ticket Log Abastecimento

Sistema base para solicitar, aprovar, auditar e executar aumento temporario de limite de abastecimento no Sou Log+ / Ticket Log.

Configuracao inicial aplicada para `ALC & Pereira Filho Transportes`:

- Expiracao do link de aprovacao: 30 minutos.
- Segunda aprovacao: a partir de R$ 0,00, ou seja, toda solicitacao aprovada exige segundo aprovador.
- Limites por grupo:
  - `GERAL_DE_RESTRICOES`: R$ 2.000,00.
  - `VEICULO_DE_PASSEIO`: R$ 70,00.
  - `UTILITARIOS`: R$ 90,00.
  - `VAN`: R$ 100,00.
  - `VUC`: R$ 150,00.

## O que esta versao cria

- API Node.js/TypeScript com Fastify.
- Painel web React/Vite.
- Worker Playwright separado.
- PostgreSQL com migration inicial.
- Redis/BullMQ para fila, locks e retentativas.
- Webhook WhatsApp com validacao de assinatura.
- Maquina de estados e politicas de limite.
- Provider para API Ticket Log com fallback opcional para navegador.
- Adapter de simulacao e adapter Playwright.
- Estrutura pronta para Railway.

## O que voce precisa me mandar depois

1. Nome da empresa.
2. Lista de usuarios autorizados: nome, matricula, e-mail corporativo, telefone WhatsApp, funcao e perfil.
3. Limite maximo por solicitacao.
4. Valor a partir do qual exige segunda aprovacao.
5. Tempo de expiracao do link de aprovacao.
6. Provedor WhatsApp escolhido: Meta Cloud API, Zenvia, Blip, Twilio, Infobip ou outro.
7. Dados do SSO corporativo: issuer, client id, client secret e claims usadas para identificar usuario.
8. Politicas por area/regional/centro de custo, se existirem.
9. Confirmacao da Ticket Log/Edenred sobre API oficial ou autorizacao para automacao por navegador.
10. Regras de retencao de auditoria e evidencias.

Como a opcao escolhida foi login proprio com MFA, a proxima etapa de autenticacao deve implementar senha com hash forte, TOTP/WebAuthn e politicas de recuperacao/revogacao.

## Comandos

```bash
npm install
npm run build
npm run dev:api
npm run dev:worker
npm run dev:web
```

## Banco

```bash
npm run db:migrate
npm run seed:dev -w @ticketlog/db
```

## Teste local atual

1. Abra `http://localhost:3000`.
2. Entre com:
   - e-mail: `dev@example.com`
   - senha: `Dev@123456`
3. Na primeira entrada, leia o QR Code com o Google Authenticator.
4. Digite o codigo de 6 digitos para ativar o MFA.
5. Crie uma solicitacao web.
6. Abra o link de aprovacao gerado.
7. Aprove a solicitacao.
8. Busque a solicitacao pelo ID e execute a segunda aprovacao.

Usuario de desenvolvimento para segunda aprovacao:

- e-mail: `approver@example.com`
- senha: `Dev@123456`

Sem `REDIS_URL`, a solicitacao chega ate `NA_FILA`, mas nao dispara worker. Quando Redis for configurado, a segunda aprovacao passa a enfileirar o job.

## Fluxos implementados

- Login proprio com senha e sessao.
- MFA TOTP compativel com Google Authenticator.
- Tela de setup MFA com QR Code.
- Criacao direta pelo painel web.
- Tela `/approval/:token` para confirmar uma solicitacao ja criada.
- Segunda aprovacao por usuario diferente do solicitante.
- Cadastro administrativo basico de usuarios.
- Politicas por grupo de veiculo.
- Modo Ticket Log `simulation`, `browser` e `ticketlog-api`.

## Modos Ticket Log

- `TICKETLOG_PROVIDER_MODE=simulation`: nao executa acoes reais.
- `TICKETLOG_PROVIDER_MODE=browser`: usa Playwright na interface Sou Log+.
- `TICKETLOG_PROVIDER_MODE=ticketlog-api`: usa a API documentada da Ticket Log e mantem o navegador como fallback quando a API nao tiver dados suficientes antes de qualquer alteracao.

Variaveis principais para `ticketlog-api`:

```bash
TICKETLOG_PROVIDER_MODE=ticketlog-api
TICKETLOG_REAL_EXECUTION=true
TICKETLOG_API_BASE_URL=https://srv1.ticketlog.com.br
TICKETLOG_API_BASIC_TOKEN=***
TICKETLOG_CODIGO_CLIENTE=249701
TICKETLOG_CODIGO_PRODUTO=4
TICKETLOG_API_TIPO_ALTERACAO=AR
TICKETLOG_API_TIPO_LIMITE=AS
TICKETLOG_API_TIPO_OPERACAO=SP
TICKETLOG_API_LIMIT_MESSAGE=.
TICKETLOG_API_ENABLE_BROWSER_FALLBACK=true
TICKETLOG_API_PLATE_CARD_MAP={"PWH4E85":"6035740000001512"}
```

Observacao: a API de limite trabalha com `numeroCartao`. Se a consulta de transacoes protegidas nao retornar o cartao da placa, configure `TICKETLOG_API_PLATE_CARD_MAP` com as placas usadas em producao ou homologacao.

Nunca coloque credenciais reais em codigo. Use variaveis protegidas no Railway ou gerenciador de segredos.
