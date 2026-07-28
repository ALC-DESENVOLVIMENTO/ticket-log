$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$storageStatePath = Join-Path $repoRoot "packages\ticketlog\.secrets\ticketlog-storage.json"
$userDataDir = Join-Path $repoRoot "packages\ticketlog\.secrets\ticketlog-userdata"

New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null
Set-Content -Path (Join-Path $userDataDir ".keep") -Value "bootstrap" -Encoding ascii

$env:TICKETLOG_VALIDATE_PLATE = "PWH4E85"
$env:TICKETLOG_ALLOW_MANUAL_LOGIN = "true"
$env:TICKETLOG_MANUAL_LOGIN_CONTINUE = "auto"
$env:TICKETLOG_MANUAL_LOGIN_TIMEOUT_MS = "900000"
$env:TICKETLOG_HEADLESS = "false"
$env:TICKETLOG_LOGIN_URL = "https://plataforma.ticketlog.com.br/home"
$env:TICKETLOG_HOME_URL = "https://plataforma.ticketlog.com.br/home"
$env:TICKETLOG_VEHICLE_LIST_URL = "https://plataforma.ticketlog.com.br/register/fleet/vehicle/list"
$env:TICKETLOG_SESSION_STORAGE_PATH = $storageStatePath
$env:TICKETLOG_USER_DATA_DIR = $userDataDir

Set-Location $repoRoot
npm.cmd run validate:browser -w @ticketlog/ticketlog
