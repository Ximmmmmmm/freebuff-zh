<#
.SYNOPSIS
  install-freebuff-zh.ps1 的端到端自测（自包含：不需要真 Freebuff，也不需要真汉化包）

.DESCRIPTION
  脚本自己造一套假环境：
    · 假安装目录：resources\app.asar + resources\orchestrator\ui\{index.html,assets\index-TEST0001.js} + Freebuff.exe
      （Freebuff.exe 优先拷一个带版本信息的系统 exe，这样「版本一致」这条路径也能测到；
        机器上找不到带版本信息的 exe 时，相关用例自动 SKIP）
    · 假汉化包：把上面那套 ui 改成 lang="zh-CN" + <meta name="hanhua-pack"> + 中文 bundle，再打成一个 zip
  然后按退出码 + 文件状态断言 10 个用例：状态查看 / 体检 / 版本不匹配中止 / 安装 / 安装后状态 /
  还原体检 / 还原 / 指定不存在的包 / 读不到版本时中止 / 应用在跑时拒绝。

  只写自己的临时目录，不碰真实安装目录、不碰注册表、不联网。

.PARAMETER Keep
  保留临时目录（排查用）。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File windows\test_installer.ps1
#>
[CmdletBinding()]
param(
    [switch] $Keep
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$HERE      = Split-Path -Parent $MyInvocation.MyCommand.Path
$INSTALLER = Join-Path $HERE 'install-freebuff-zh.ps1'
$PSHOST    = (Get-Process -Id $PID).Path          # 当前宿主（powershell.exe 或 pwsh.exe）

if (-not (Test-Path -LiteralPath $INSTALLER)) { Write-Host "找不到 $INSTALLER" -ForegroundColor Red; exit 1 }

$script:pass = 0
$script:fail = 0
$script:skip = 0

function Title { param([string]$m) Write-Host "`n########## $m ##########" -ForegroundColor Cyan }
function Check {
    param([string]$Name, [bool]$Cond, [string]$Detail = '')
    if ($Cond) { Write-Host "  [PASS] $Name" -ForegroundColor Green; $script:pass++ }
    else       { Write-Host "  [FAIL] $Name  $Detail" -ForegroundColor Red;   $script:fail++ }
}
function Skip { param([string]$Name, [string]$Why) Write-Host "  [SKIP] $Name（$Why）" -ForegroundColor Yellow; $script:skip++ }
function Utf8NoBom { [System.Text.UTF8Encoding]::new($false) }

function Invoke-Installer {
    param([string[]]$ArgList)
    $out = & $PSHOST -NoProfile -ExecutionPolicy Bypass -File $INSTALLER @ArgList 2>&1
    return [pscustomobject]@{ Rc = $LASTEXITCODE; Out = ($out | Out-String) }
}
function Read-Text { param([string]$p) [System.IO.File]::ReadAllText($p) }

# ------------------------------------------------------------------ 造夹具
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('fbzh-selftest-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$fake = Join-Path $root 'fake-install'
$res  = Join-Path $fake 'resources'
$ui   = Join-Path $res 'orchestrator\ui'
$ast  = Join-Path $ui 'assets'
$bundle = 'index-TEST0001.js'
$ORIG_ASAR = 1MB
$PACK_ASAR = 2MB

New-Item -ItemType Directory -Path $ast -Force | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path $res 'app.asar'), [byte[]]::new($ORIG_ASAR))
[System.IO.File]::WriteAllText((Join-Path $ui 'index.html'),
    "<!doctype html>`n<html lang=`"en`">`n<head><title>Freebuff</title></head>`n<body><script type=`"module`" src=`"./assets/$bundle`"></script></body>`n</html>`n",
    (Utf8NoBom))
[System.IO.File]::WriteAllText((Join-Path $ast $bundle),
    'console.log("Hello, English UI");' + "`n", (Utf8NoBom))

# 带版本信息的 exe：优先系统自带，其次当前宿主自己
$verExe = $null
foreach ($cand in @(
        (Join-Path $env:SystemRoot 'System32\notepad.exe'),
        (Join-Path $env:SystemRoot 'System32\mspaint.exe'),
        (Join-Path $env:SystemRoot 'System32\calc.exe'),
        $PSHOST)) {
    if (-not $cand) { continue }
    if (-not (Test-Path -LiteralPath $cand)) { continue }
    $v = (Get-Item -LiteralPath $cand).VersionInfo.FileVersion
    if ($v) { $verExe = $cand; break }
}
$exeVersion = ''
if ($verExe) { $exeVersion = ((Get-Item -LiteralPath $verExe).VersionInfo.FileVersion -replace '\s.*$', '') }
Copy-Item -LiteralPath $(if ($verExe) { $verExe } else { (Join-Path $ast $bundle) }) -Destination (Join-Path $fake 'Freebuff.exe') -Force

# 假汉化包：版本戳取「假 exe 的版本」，让版本一致这条路径能走通
$packVer = if ($exeVersion) { $exeVersion } else { '0.0.173' }
$packSrc = Join-Path $root 'pack-src'
$packUi  = Join-Path $packSrc 'ui'
$packAst = Join-Path $packUi 'assets'
New-Item -ItemType Directory -Path $packAst -Force | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path $packSrc 'app.asar'), [byte[]]::new($PACK_ASAR))
[System.IO.File]::WriteAllText((Join-Path $packUi 'index.html'),
    "<!doctype html>`n<html lang=`"zh-CN`">`n<head>`n<meta name=`"hanhua-pack`" content=`"$packVer`">`n</head>`n<body><script type=`"module`" src=`"./assets/$bundle`"></script></body>`n</html>`n",
    (Utf8NoBom))
[System.IO.File]::WriteAllText((Join-Path $packAst $bundle),
    '/* ' + ('汉化自测文案' * 400) + ' */' + "`n", (Utf8NoBom))

Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
$zip    = Join-Path $root 'hanhua-pack-selftest.zip'
$zipBad = Join-Path $root 'hanhua-pack-selftest-bad.zip'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($packSrc, $zip)
Copy-Item -LiteralPath $zip -Destination $zipBad -Force

# 改掉副本 zip 里的版本戳 → 版本不匹配
$za = [System.IO.Compression.ZipFile]::Open($zipBad, 'Update')
try {
    # 注意：.NET Framework 的 CreateFromDirectory 在 Windows 上用 "\" 做分隔符，.NET Core 用 "/" —— 两种都认
    $entry = $za.Entries | Where-Object { ($_.FullName -replace '\\', '/') -eq 'ui/index.html' } | Select-Object -First 1
    if (-not $entry) { throw "zip 里没有 ui/index.html" }
    $rd = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
    $html = $rd.ReadToEnd(); $rd.Close()
    $html = $html -replace 'name="hanhua-pack"([^>]*)content="[^"]*"', 'name="hanhua-pack"$1content="0.0.999.9"'
    $st = $entry.Open(); $st.SetLength(0)
    $wr = New-Object System.IO.StreamWriter($st, (Utf8NoBom)); $wr.Write($html); $wr.Flush(); $wr.Dispose()
} finally { $za.Dispose() }

# 读不到版本的假安装目录（Freebuff.exe 是个文本文件）
$fake2 = Join-Path $root 'fake-nover'
New-Item -ItemType Directory -Path (Join-Path $fake2 'resources\orchestrator\ui\assets') -Force | Out-Null
[System.IO.File]::WriteAllText((Join-Path $fake2 'Freebuff.exe'), 'not a real exe', (Utf8NoBom))
[System.IO.File]::WriteAllBytes((Join-Path $fake2 'resources\app.asar'), [byte[]]::new(4096))
[System.IO.File]::WriteAllText((Join-Path $fake2 'resources\orchestrator\ui\index.html'),
    "<html lang=`"en`"><script src=`"./assets/$bundle`"></script></html>", (Utf8NoBom))

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  install-freebuff-zh.ps1 · 自包含端到端自测' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host "  宿主：$PSHOST"
Write-Host "  假安装目录：$fake"
Write-Host "  假汉化包：$zip（版本戳 $packVer）"
if (-not $verExe) { Write-Host '  [!] 机器上找不到带版本信息的 exe，「版本一致」相关用例将 SKIP' -ForegroundColor Yellow }

# ------------------------------------------------------------------ 用例
Title 'T1 -List（英文原版，应 rc=0）'
$r = Invoke-Installer @('-InstallDir', $fake, '-List')
Check 'rc=0' ($r.Rc -eq 0) "rc=$($r.Rc)"
Check '识别为英文原版' ($r.Out -match '当前是英文原版') ''

Title 'T2 -DryRun（版本一致，应 rc=0）'
$r = Invoke-Installer @('-InstallDir', $fake, '-Pack', $zip, '-DryRun', '-ProcessName', 'FreebuffNoSuchApp')
if (-not $exeVersion) {
    Skip '-DryRun 体检通过' '假 exe 没有版本信息'
    Check 'rc=1（读不到版本时中止）' ($r.Rc -eq 1) "rc=$($r.Rc)"
} else {
    Check 'rc=0' ($r.Rc -eq 0) "rc=$($r.Rc)"
    Check '判定版本一致' ($r.Out -match '版本一致，可以安装') ''
}
Check '体检模式不改文件' ((Read-Text (Join-Path $ui 'index.html')) -match 'lang="en"') ''

Title 'T3 -DryRun（版本不匹配，应 rc=1）'
$r = Invoke-Installer @('-InstallDir', $fake, '-Pack', $zipBad, '-DryRun', '-ProcessName', 'FreebuffNoSuchApp')
Check 'rc=1' ($r.Rc -eq 1) "rc=$($r.Rc)"
Check '报版本不匹配' ($r.Out -match '版本不匹配') ''

Title 'T4 安装（应 rc=0，且备份 + 替换都落地）'
$r = Invoke-Installer @('-InstallDir', $fake, '-Pack', $zip, '-ProcessName', 'FreebuffNoSuchApp')
Check 'rc=0' ($r.Rc -eq 0) "rc=$($r.Rc)"
Check '自校验通过' ($r.Out -match '校验通过：汉化已生效') ''
$html = Read-Text (Join-Path $ui 'index.html')
Check 'index.html 变成 lang="zh-CN"' ($html -match 'lang="zh-CN"') ''
Check '写入汉化包版本戳' ($html -match 'name="hanhua-pack"') ''
Check "app.asar 被替换（$([int]($PACK_ASAR/1MB)) MB）" ((Get-Item -LiteralPath (Join-Path $res 'app.asar')).Length -eq $PACK_ASAR) ''
$backups = @(Get-ChildItem -LiteralPath $res -Directory -Filter 'hanhua-backup-*' -ErrorAction SilentlyContinue)
Check '创建了 hanhua-backup-*' ($backups.Count -eq 1) "count=$($backups.Count)"
if ($backups.Count -ge 1) {
    $b = $backups[0]
    Check '备份里有原版 app.asar（1 MB）' ((Get-Item -LiteralPath (Join-Path $b.FullName 'app.asar')).Length -eq $ORIG_ASAR) ''
    Check '备份里有原版 ui\' (Test-Path -LiteralPath (Join-Path $b.FullName 'ui\index.html')) ''
}
Check '解包临时目录已清理' (@(Get-ChildItem ([System.IO.Path]::GetTempPath()) -Directory -Filter 'fbzh-pack-*' -ErrorAction SilentlyContinue).Count -eq 0) ''

Title 'T5 -List（汉化状态，应 rc=0）'
$r = Invoke-Installer @('-InstallDir', $fake, '-List')
Check 'rc=0' ($r.Rc -eq 0) "rc=$($r.Rc)"
Check '识别为汉化状态' ($r.Out -match '当前是汉化状态') ''

Title 'T6 -Restore -DryRun（应 rc=0，且不改文件）'
$r = Invoke-Installer @('-InstallDir', $fake, '-Restore', '-DryRun', '-ProcessName', 'FreebuffNoSuchApp')
Check 'rc=0' ($r.Rc -eq 0) "rc=$($r.Rc)"
Check '体检不改文件' ((Get-Item -LiteralPath (Join-Path $res 'app.asar')).Length -eq $PACK_ASAR) ''

Title 'T7 -Restore（应 rc=0，还原成英文原版）'
$r = Invoke-Installer @('-InstallDir', $fake, '-Restore', '-ProcessName', 'FreebuffNoSuchApp')
Check 'rc=0' ($r.Rc -eq 0) "rc=$($r.Rc)"
Check '报已回到英文原版' ($r.Out -match '已回到英文原版') ''
Check "app.asar 还原成 1 MB" ((Get-Item -LiteralPath (Join-Path $res 'app.asar')).Length -eq $ORIG_ASAR) ''
Check 'index.html 回到 lang="en"' ((Read-Text (Join-Path $ui 'index.html')) -match 'lang="en"') ''

Title 'T8 -Pack 指向不存在的文件（应 rc=1）'
$r = Invoke-Installer @('-InstallDir', $fake, '-Pack', (Join-Path $root 'nope.zip'), '-DryRun', '-ProcessName', 'FreebuffNoSuchApp')
Check 'rc=1' ($r.Rc -eq 1) "rc=$($r.Rc)"
Check '提示指定的包不存在' ($r.Out -match '指定的汉化包不存在') ''

Title 'T9 读不到已装版本（应 rc=1，不加 -Force）'
$r = Invoke-Installer @('-InstallDir', $fake2, '-Pack', $zip, '-DryRun', '-ProcessName', 'FreebuffNoSuchApp')
Check 'rc=1' ($r.Rc -eq 1) "rc=$($r.Rc)"
Check '提示无法确认版本' ($r.Out -match '无法确认版本') ''

Title 'T10 应用正在运行（应 rc=1，且不杀进程）'
$sleeper = $null
try {
    $sleeper = Start-Process -FilePath $PSHOST -ArgumentList '-NoProfile', '-Command', 'Start-Sleep -Seconds 120' -PassThru
    Start-Sleep -Milliseconds 800
    $pn = [System.IO.Path]::GetFileNameWithoutExtension($PSHOST)
    $r = Invoke-Installer @('-InstallDir', $fake, '-Pack', $zip, '-ProcessName', $pn)
    Check 'rc=1' ($r.Rc -eq 1) "rc=$($r.Rc)"
    Check '提示应用正在运行' ($r.Out -match '正在运行') ''
    Check '没有杀进程' (-not $sleeper.HasExited) ''
} catch {
    Skip '应用正在运行守卫' "无法启动假进程：$($_.Exception.Message)"
} finally {
    if ($sleeper -and -not $sleeper.HasExited) { Stop-Process -Id $sleeper.Id -Force -ErrorAction SilentlyContinue }
}

# ------------------------------------------------------------------ 收尾
if (-not $Keep) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host '---------------- 结果 ----------------' -ForegroundColor Cyan
Write-Host ("  通过 {0} · 失败 {1} · 跳过 {2}" -f $script:pass, $script:fail, $script:skip)
if ($Keep) { Write-Host "  临时目录保留在：$root" }
if ($script:fail -gt 0) { Write-Host '  有用例失败' -ForegroundColor Red; exit 1 }
Write-Host '  全部通过' -ForegroundColor Green
exit 0
