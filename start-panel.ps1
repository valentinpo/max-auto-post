$ErrorActionPreference = 'SilentlyContinue'

# Останавливаем всё, что висит на порту 3001
$conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    foreach ($c in $conn) {
        Stop-Process -Id $c.OwningProcess -Force
    }
    Start-Sleep -Seconds 2
}

# Запуск панели как отдельный процесс (не в job, не привязан к этой консоли)
$dir = 'C:\Users\eqsrf_1\Desktop\akb\site_v2\max-auto-post'
$out = "$env:TEMP\max-panel.log"

# Отключаем проверку сертификатов в Node (нужно для доступа к platform-api2.max.ru
# из-за корневого сертификата Минцифры, которого нет в CA-store Node)
$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'

$p = Start-Process -FilePath 'node.exe' -ArgumentList 'server.js' -WorkingDirectory $dir -RedirectStandardOutput $out -RedirectStandardError "$env:TEMP\max-panel-err.log" -WindowStyle Hidden -PassThru
Write-Output ("Started PID: " + $p.Id)
Start-Sleep -Seconds 4

# Проверка
Write-Output "== лог =="
if (Test-Path $out) { Get-Content -Raw $out }
Write-Output "== порт =="
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress, OwningProcess
Write-Output "== тест =="
try { $r = Invoke-WebRequest -Uri 'http://localhost:3001/api/state' -UseBasicParsing -TimeoutSec 8; Write-Output ("OK: " + $r.StatusCode) } catch { Write-Output ("ERR: " + $_.Exception.Message) }