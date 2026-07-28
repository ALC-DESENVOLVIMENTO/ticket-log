$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$requestId = if ($args.Count -gt 0) { $args[0] } else { $env:REQUEST_ID }

if ([string]::IsNullOrWhiteSpace($requestId)) {
  throw "Informe o REQUEST_ID como argumento. Ex.: .\\scripts\\process-local-request.ps1 3a76554d-1fb4-48f9-b3ca-60049876a779"
}

$env:TICKETLOG_PROVIDER_MODE = "browser"
$env:TICKETLOG_REAL_EXECUTION = "true"
$env:TICKETLOG_HEADLESS = "false"
$env:TICKETLOG_ALLOW_MANUAL_LOGIN = "true"
$env:TICKETLOG_MANUAL_LOGIN_TIMEOUT_MS = "900000"
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
$env:DATABASE_URL = "postgresql://postgres:vJlrAzKplbffUZdedKhJBnlfAVlTQHZN@sakura.proxy.rlwy.net:21162/railway?sslmode=require"
$env:REDIS_URL = "redis://default:IzBTJFAsISjtRtAwqHcwsVHMUDxDFYVE@shuttle.proxy.rlwy.net:51667"
$env:TICKETLOG_LOGIN_URL = "https://plataforma.ticketlog.com.br/home"
$env:TICKETLOG_HOME_URL = "https://plataforma.ticketlog.com.br/home"
$env:TICKETLOG_VEHICLE_LIST_URL = "https://plataforma.ticketlog.com.br/register/fleet/vehicle/list"
$env:TICKETLOG_SESSION_STORAGE_PATH = Join-Path $repoRoot "packages\ticketlog\.secrets\ticketlog-storage.json"
$env:TICKETLOG_USER_DATA_DIR = Join-Path $repoRoot "packages\ticketlog\.secrets\ticketlog-userdata"

Set-Location $repoRoot
npm.cmd run build:worker
node .\scripts\process-local-request.mjs $requestId
