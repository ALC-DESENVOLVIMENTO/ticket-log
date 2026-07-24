# Deploy no Railway

Crie um projeto com os seguintes servicos:

1. PostgreSQL.
2. Redis.
3. API usando `apps/api/Dockerfile`.
4. Web usando `apps/web/Dockerfile`.
5. Worker usando `apps/worker-playwright/Dockerfile`.

## Variaveis

Copie `.env.example` para as variaveis do Railway, separando valores por ambiente.

Obrigatorias:

- `DATABASE_URL`
- `REDIS_URL`
- `APP_BASE_URL`
- `APP_SIGNING_SECRET`
- `FIELD_ENCRYPTION_KEY`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `TICKETLOG_PROVIDER_MODE`

## Health checks

- API: `/healthz`
- Readiness API: `/readyz`
- Web: `/`
- Worker: monitorar logs, fila BullMQ e heartbeat futuro.

## Armazenamento

Nao use filesystem local do Railway para evidencias permanentes. Configure S3, R2, GCS ou Azure Blob.

## Rollback

Use deploy por commit, migrations revisadas e feature flag `TICKETLOG_PROVIDER_MODE=simulation` para desligar a automacao real sem desligar o processo de solicitacao/aprovacao.
