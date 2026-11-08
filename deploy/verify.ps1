# ============================================================
#  Verifikasi dari komputer MANA SAJA (biasanya laptop peserta)
#  Pakai:
#    powershell -ExecutionPolicy Bypass -File deploy\verify.ps1 -Target 203.0.113.10
# ============================================================
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [int]$TimeoutMs = 5000
)

$tcpPorts = [ordered]@{
  'arena'          = 8080
  'web-portal'     = 3000
  'web-swag'       = 4000
  'web-merchtech'  = 5000
  'web-landing'    = 6060
  'pwn-admin'      = 9001
  'pwn-feedback'   = 9002
  'pwn-weapon'     = 9003
  'crypto-twin'    = 1337
  'forensics-1'    = 10001
  'forensics-2'    = 10002
  'forensics-3'    = 10003
}

Write-Output ("TARGET: {0}`n" -f $Target)
$up = 0; $down = 0

foreach ($name in $tcpPorts.Keys) {
  $p = $tcpPorts[$name]
  $client = New-Object System.Net.Sockets.TcpClient
  $task = $client.ConnectAsync($Target, $p)
  $ok = $task.Wait($TimeoutMs) -and $client.Connected
  if ($ok) { $up++ } else { $down++ }
  $status = if ($ok) { "UP  " } else { "DOWN" }
  $color = if ($ok) { "Green" } else { "Red" }
  Write-Host ("  [{0}] {1,-16} :{2}" -f $status, $name, $p) -ForegroundColor $color
  $client.Close()
}

Write-Output ""
try {
  $health = Invoke-RestMethod "http://${Target}:8080/api/health" -TimeoutSec $TimeoutMs
  Write-Output ("  ARENA HEALTH : {0} soal | IP di API = {1} | port = {2}" -f $health.challenges, $health.serverIp, $health.port)
} catch {
  Write-Host "  ARENA HEALTH : GAGAL ($_)" -ForegroundColor Red
}

try {
  $c = Invoke-RestMethod "http://${Target}:8080/api/challenges" -TimeoutSec $TimeoutMs
  $leaked = (Invoke-WebRequest "http://${Target}:8080/api/challenges" -UseBasicParsing).Content
  $hasFlagField = $leaked -match '"flag"'
  $resolved = ($c.challenges | Where-Object { $_.description -match '<SERVER_IP>' }).Count
  Write-Output ("  CHALLENGES   : {0} soal | field flag bocor: {1} | <SERVER_IP> belum diganti: {2}" -f $c.challenges.Count, $hasFlagField, $resolved)
} catch {
  Write-Host "  CHALLENGES   : GAGAL ($_)" -ForegroundColor Red
}

Write-Output ""
Write-Output ("HASIL: {0} port UP, {1} port DOWN" -f $up, $down)
if ($down -eq 0) { Write-Host "SEMUA PORT TERJANGKAU DARI INTERNET." -ForegroundColor Green }
else { Write-Host "ADA PORT TERBLOKIR — cek UFW / firewall provider / port mapping VPS." -ForegroundColor Yellow }
