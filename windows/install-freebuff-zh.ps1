<#
.SYNOPSIS
  Freebuff 桌面版「汉化包」Windows 一键安装 / 还原（纯 PowerShell，不需要 Git Bash、不需要管理员）

.DESCRIPTION
  把 hanhua-pack-<版本>.zip（或一个含 app.asar 与 ui\ 的目录）装进 Freebuff 安装目录，只写两个位置：
      <安装目录>\resources\app.asar
      <安装目录>\resources\orchestrator\ui\
  装之前把原版备份到 <安装目录>\resources\hanhua-backup-<时间戳>\，随时可用 -Restore 一键还原。
  脚本不联网（除非显式 -Download）、不改注册表、不碰用户数据、不删任何备份。

.PARAMETER Pack
  汉化包 zip，或含 app.asar + ui\ 的目录。不给则自动在脚本所在目录、脚本目录\dist、上级目录\dist、当前目录、桌面、用户下载目录里找最新的 hanhua-pack-*.zip（找不到会把这几个目录列出来）。

.PARAMETER InstallDir
  Freebuff 安装目录。不给则自动探测（%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop）。

.PARAMETER Restore
  还原：把最近一次备份（或 -Backup 指定的那次）复制回安装目录。

.PARAMETER Backup
  配合 -Restore，指定要还原的备份目录名或完整路径。

.PARAMETER List
  只看状态：安装目录、已装版本、当前是否汉化、备份清单。不做任何修改。

.PARAMETER Download
  本地找不到汉化包时，从 GitHub Releases 下载最新包（走 api.github.com，20 MB 左右）。

.PARAMETER Force
  ① 应用正在运行时强制结束它再装（默认拒绝，避免出现「界面中文、主进程英文」的混合态）；
  ② 汉化包 targetVersion 与已装 Freebuff 版本不一致时继续装（默认中止：包里是含全部应用代码的 app.asar，装错版本等于把应用代码换掉）。

.PARAMETER DryRun
  只体检不动手：把每一步会做什么打印出来。退出码即结论：0 = 可以装，1 = 真实安装会被中止（版本不匹配 / 应用还在跑）。

.PARAMETER KeepTemp
  保留解包出来的临时目录，便于排查。

.PARAMETER ProcessName
  应用进程名，默认 Freebuff（可执行文件被改名时才需要改）。

.EXAMPLE
  .\install-freebuff-zh.ps1
.EXAMPLE
  .\install-freebuff-zh.ps1 -Pack "$env:USERPROFILE\Downloads\hanhua-pack-0.0.173.1.zip"
.EXAMPLE
  .\install-freebuff-zh.ps1 -List
.EXAMPLE
  .\install-freebuff-zh.ps1 -Restore
#>
[CmdletBinding()]
param(
    [string] $Pack,
    [string] $InstallDir,
    [switch] $Restore,
    [string] $Backup,
    [switch] $List,
    [switch] $Download,
    [switch] $Force,
    [switch] $DryRun,
    [switch] $KeepTemp,
    [string] $ProcessName = 'Freebuff'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$APP_NAME     = 'Freebuff'
$DEFAULT_REL  = 'Programs\@codebufffreebuff-desktop'
$RELEASES_API = 'https://api.github.com/repos/Ximmmmmmm/freebuff-zh/releases/latest'

# 临时目录句柄（Fail 时也要清理，先声明避免 StrictMode 报未定义变量）
$work  = $null
$tmpDl = $null
# 找包时搜过的目录（找不到包时报给用户看）
$packSearchDirs = @()

# ---------------------------------------------------------------- 输出helpers
function Line   { param([string]$m) Write-Host $m }
function Step   { param([string]$n,[string]$m) Write-Host "`n[$n] $m" -ForegroundColor Cyan }
function Info   { param([string]$m) Write-Host "     $m" }
function Ok     { param([string]$m) Write-Host "     [OK] $m" -ForegroundColor Green }
function Warn   { param([string]$m) Write-Host "     [!]  $m" -ForegroundColor Yellow }
function Fail   {
    param([string]$m)
    Write-Host "     [X]  $m" -ForegroundColor Red
    # 中止时也别把解包临时目录留在 %TEMP% 里
    if (-not $KeepTemp) {
        foreach ($d in @($script:work, $script:tmpDl)) {
            if ($d -and (Test-Path -LiteralPath $d)) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    exit 1
}
function Bytes  { param([long]$n) if ($n -ge 1MB) { '{0:N1} MB' -f ($n/1MB) } elseif ($n -ge 1KB) { '{0:N1} KB' -f ($n/1KB) } else { "$n B" } }

function Show-Header {
    Line ''
    Line '============================================================'
    Line "  Freebuff 桌面版 汉化包 · Windows 一键安装 / 还原"
    Line '============================================================'
    if ($DryRun) { Warn '体检模式（-DryRun）：只打印，不改任何文件' }
}

# ---------------------------------------------------------------- 探测安装目录
function Resolve-InstallDir {
    param([string]$Given)

    $cands = New-Object System.Collections.ArrayList
    if ($Given) { [void]$cands.Add($Given) }
    if ($env:LOCALAPPDATA) { [void]$cands.Add((Join-Path $env:LOCALAPPDATA $DEFAULT_REL)) }
    foreach ($k in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                     'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        try {
            Get-ItemProperty $k -ErrorAction SilentlyContinue |
                Where-Object { $_.DisplayName -like "*$APP_NAME*" -and $_.InstallLocation } |
                ForEach-Object { [void]$cands.Add($_.InstallLocation) }
        } catch { }
    }

    foreach ($c in $cands) {
        if (-not $c) { continue }
        $c = $c.TrimEnd('\')
        if ((Test-Path -LiteralPath (Join-Path $c 'Freebuff.exe')) -and
            (Test-Path -LiteralPath (Join-Path $c 'resources'))) { return $c }
    }
    Fail "没找到 Freebuff 安装目录。请用 -InstallDir 指定（正常是 %LOCALAPPDATA%\Programs\@codebufffreebuff-desktop）"
}

function Get-AppVersion {
    param([string]$Dir)
    $exe = Join-Path $Dir 'Freebuff.exe'
    try { $v = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion } catch { $v = $null }
    if (-not $v) { try { $v = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion } catch { $v = $null } }
    if (-not $v) { $v = '未知' }
    return ($v -replace '\s.*$','')
}

function Get-LocalizeState {
    param([string]$Dir)
    $idx = Join-Path $Dir 'resources\orchestrator\ui\index.html'
    $st = [ordered]@{ Lang = '(无 ui/index.html)'; Pack = ''; Bundle = ''; BundleSize = 0; Cjk = 0 }
    if (-not (Test-Path -LiteralPath $idx)) { return [pscustomobject]$st }
    $html = Get-Content -LiteralPath $idx -Raw -Encoding UTF8
    $m = [regex]::Match($html, 'lang="([^"]*)"')
    if ($m.Success) { $st.Lang = $m.Groups[1].Value }
    $m = [regex]::Match($html, 'name="hanhua-pack"[^>]*content="([^"]*)"')
    if ($m.Success) { $st.Pack = $m.Groups[1].Value }
    $m = [regex]::Match($html, 'assets/(index-[A-Za-z0-9_\-]+\.js)')
    if ($m.Success) {
        $st.Bundle = $m.Groups[1].Value
        $bp = Join-Path $Dir ('resources\orchestrator\ui\assets\' + $m.Groups[1].Value)
        if (Test-Path -LiteralPath $bp) {
            $st.BundleSize = (Get-Item -LiteralPath $bp).Length
            $txt = [System.IO.File]::ReadAllText($bp)
            $st.Cjk = ([regex]::Matches($txt, '[\u4e00-\u9fff]')).Count
        }
    }
    return [pscustomobject]$st
}

function Get-Backups {
    param([string]$Dir)
    $root = Join-Path $Dir 'resources'
    if (-not (Test-Path -LiteralPath $root)) { return @() }
    return @(Get-ChildItem -LiteralPath $root -Directory -Filter 'hanhua-backup-*' -ErrorAction SilentlyContinue |
             Sort-Object Name -Descending)
}

# ---------------------------------------------------------------- 找汉化包
function Find-Pack {
    param([string]$Given)

    if ($Given) {
        if (-not (Test-Path -LiteralPath $Given)) { Fail "指定的汉化包不存在：$Given" }
        return (Resolve-Path -LiteralPath $Given).Path
    }

    $dirs = New-Object System.Collections.ArrayList
    [void]$dirs.Add($PSScriptRoot)
    [void]$dirs.Add((Join-Path $PSScriptRoot 'dist'))
    [void]$dirs.Add((Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'))
    try { [void]$dirs.Add((Get-Location).Path) } catch { }
    if ($env:USERPROFILE) {
        [void]$dirs.Add((Join-Path $env:USERPROFILE 'Desktop'))
        [void]$dirs.Add((Join-Path $env:USERPROFILE 'Downloads'))
    }

    # 去重，并记下找过哪些目录（找不到时报给用户看）
    $seen = New-Object System.Collections.ArrayList
    $script:packSearchDirs = @()
    foreach ($d in $dirs) {
        if (-not $d) { continue }
        $full = $d
        try { $full = (Resolve-Path -LiteralPath $d -ErrorAction Stop).Path } catch { $full = $d }
        if ($seen -contains $full) { continue }
        [void]$seen.Add($full)
    }
    $script:packSearchDirs = $seen.ToArray()

    foreach ($d in $script:packSearchDirs) {
        if (-not (Test-Path -LiteralPath $d)) { continue }
        $hit = Get-ChildItem -LiteralPath $d -Filter 'hanhua-pack-*.zip' -File -ErrorAction SilentlyContinue |
               Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

function Get-PackFromGitHub {
    param([string]$DestDir)
    Info "查询最新 Release：$RELEASES_API"
    $hdr = @{ 'User-Agent' = 'freebuff-zh-installer'; 'Accept' = 'application/vnd.github+json' }
    $rel = Invoke-RestMethod -Uri $RELEASES_API -Headers $hdr -TimeoutSec 30
    $asset = $rel.assets | Where-Object { $_.name -like 'hanhua-pack-*.zip' } | Select-Object -First 1
    if (-not $asset) { Fail '最新 Release 里没有 hanhua-pack-*.zip 资产' }
    $out = Join-Path $DestDir $asset.name
    Info "下载 $($asset.name)（$(Bytes $asset.size)）…"
    $h2 = @{ 'User-Agent' = 'freebuff-zh-installer'; 'Accept' = 'application/octet-stream' }
    Invoke-WebRequest -Uri $asset.url -Headers $h2 -OutFile $out -TimeoutSec 600
    Ok "已下载：$out"
    return $out
}

# ---------------------------------------------------------------- 进程检查
function Read-ZipEntryText {
    # 不解包，直接从 zip 里读一个文本条目（用来读 ui\index.html 里的版本戳）
    param([string]$Zip, [string]$Suffix)
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
        $z = [System.IO.Compression.ZipFile]::OpenRead($Zip)
        try {
            $want = $Suffix -replace '\\', '/'
            $e = $z.Entries | Where-Object { ($_.FullName -replace '\\', '/') -eq $want } | Select-Object -First 1
            if (-not $e) {
                $e = $z.Entries | Where-Object { ($_.FullName -replace '\\', '/') -like "*$want" } | Select-Object -First 1
            }
            if (-not $e) { return $null }
            $sr = New-Object System.IO.StreamReader($e.Open(), [System.Text.Encoding]::UTF8)
            try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
        } finally { $z.Dispose() }
    } catch {
        return $null
    }
}

function Get-AppProcesses {
    return @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
}

function Assert-AppClosed {
    $procs = @(Get-AppProcesses)
    if ($procs.Count -eq 0) { Ok "Freebuff 未在运行"; return }
    if ($DryRun) { Warn "Freebuff 正在运行（$($procs.Count) 个进程）——真实安装时这里会拒绝执行"; return }
    if (-not $Force) {
        Warn "Freebuff 正在运行（$($procs.Count) 个进程）：$([string]::Join(', ', ($procs | Select-Object -ExpandProperty Id)))"
        Fail "请先彻底退出 Freebuff（含多开实例、托盘图标），再重跑本脚本；确认要强制结束时加 -Force。`n          热替换会留下「界面中文、主进程英文」的混合态，之后每个写操作都会 403 forbidden。"
    }
    Warn "按 -Force 强制结束 Freebuff（$($procs.Count) 个进程）"
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 1200
    $left = @(Get-AppProcesses)
    if ($left.Count -gt 0) { Fail "还有 $($left.Count) 个进程没退干净，请手动结束后重试" }
    Ok "已结束 Freebuff"
}

# ---------------------------------------------------------------- 主体
Show-Header

# ---- 安装目录与现状
Step '1/6' '定位 Freebuff 安装目录'
$dir = Resolve-InstallDir -Given $InstallDir
Ok "安装目录：$dir"
$appVer = Get-AppVersion -Dir $dir
Info "已装版本：$appVer"
$state = Get-LocalizeState -Dir $dir
Info "界面语言：lang=`"$($state.Lang)`"$(if ($state.Pack) { " · 汉化包 $($state.Pack)" })"
if ($state.Bundle) { Info "主 bundle：$($state.Bundle)（$(Bytes $state.BundleSize)，中文字符 $($state.Cjk) 个）" }
if ($state.Pack) { Ok '当前是汉化状态' } else { Info '当前是英文原版（未汉化）' }

$backups = @(Get-Backups -Dir $dir)
if ($backups.Count -gt 0) {
    Info "已有备份 $($backups.Count) 个，最近一个：$($backups[0].Name)"
} else {
    Info '还没有备份（首次安装会创建）'
}

# ---- -List 到此为止
if ($List) {
    Step '备份清单' "(按时间倒序)"
    if ($backups.Count -eq 0) { Info '(无)' } else {
        foreach ($b in $backups) {
            $bAsar = Join-Path $b.FullName 'app.asar'
            $sz = if (Test-Path -LiteralPath $bAsar) { Bytes (Get-Item -LiteralPath $bAsar).Length } else { '缺 app.asar' }
            Info "$($b.Name)   $sz   $($b.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"
        }
    }
    Line ''
    Line '（-List 模式，未做任何修改）'
    exit 0
}

# ---- 还原分支
if ($Restore) {
    Step '还原' '把备份复制回安装目录'
    if ($backups.Count -eq 0) { Fail '没有任何 hanhua-backup-* 备份，无法还原' }

    $target = $null
    if ($Backup) {
        if (Test-Path -LiteralPath $Backup) { $target = Get-Item -LiteralPath $Backup }
        else {
            $hit = $backups | Where-Object { $_.Name -eq $Backup } | Select-Object -First 1
            if ($hit) { $target = $hit } else { Fail "找不到备份：$Backup" }
        }
    } else {
        $target = $backups[0]
    }
    Info "使用备份：$($target.Name)"

    $srcAsar = Join-Path $target.FullName 'app.asar'
    $srcUi   = Join-Path $target.FullName 'ui'
    if (-not (Test-Path -LiteralPath $srcAsar)) { Fail "备份里没有 app.asar：$srcAsar" }
    if (-not (Test-Path -LiteralPath $srcUi))   { Warn "备份里没有 ui\ 目录，将只还原 app.asar" }

    Assert-AppClosed

    $dstAsar = Join-Path $dir 'resources\app.asar'
    $dstUi   = Join-Path $dir 'resources\orchestrator\ui'
    if ($DryRun) {
        Info "[DryRun] 会执行：Copy $srcAsar -> $dstAsar"
        if (Test-Path -LiteralPath $srcUi) { Info "[DryRun] 会执行：Copy $srcUi\* -> $dstUi" }
    } else {
        Copy-Item -LiteralPath $srcAsar -Destination $dstAsar -Force
        Ok "app.asar 已还原（$(Bytes (Get-Item -LiteralPath $dstAsar).Length)）"
        if (Test-Path -LiteralPath $srcUi) {
            if (-not (Test-Path -LiteralPath $dstUi)) { New-Item -ItemType Directory -Path $dstUi -Force | Out-Null }
            Copy-Item -Path (Join-Path $srcUi '*') -Destination $dstUi -Recurse -Force
            Ok 'ui\ 已还原'
        }
    }

    if (-not $DryRun) {
        $after = Get-LocalizeState -Dir $dir
        Line ''
        Line '---------------- 还原结果 ----------------'
        Info "界面语言：lang=`"$($after.Lang)`"$(if ($after.Pack) { " · 汉化包 $($after.Pack)" })"
        if ($after.Pack) { Warn 'index.html 里仍有汉化包版本戳，可能备份本身就是汉化版' } else { Ok '已回到英文原版' }
        Info "备份目录仍保留在：$($target.FullName)"
    }
    exit 0
}

# ---- 找包
Step '2/6' '定位汉化包'
$packPath = Find-Pack -Given $Pack
if (-not $packPath) {
    if ($Download) {
        $tmpDl = Join-Path ([System.IO.Path]::GetTempPath()) ('fbzh-dl-' + [guid]::NewGuid().ToString('N').Substring(0,8))
        New-Item -ItemType Directory -Path $tmpDl -Force | Out-Null
        $packPath = Get-PackFromGitHub -DestDir $tmpDl
    } else {
        Warn '没找到 hanhua-pack-*.zip。已经找过这些目录：'
        foreach ($d in @($script:packSearchDirs)) { Info "  $d" }
        Fail '请把 hanhua-pack-<版本>.zip 放到上面任一目录，或用 -Pack <路径> 指定，或加 -Download 从 GitHub Releases 下载。'
    }
}
$packItem = Get-Item -LiteralPath $packPath
Ok "汉化包：$($packItem.FullName)"
Info "大小：$(Bytes $packItem.Length) · 修改时间：$($packItem.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"

# ---- 解包
Step '3/6' '解包并校验'
$isDir  = $packItem.PSIsContainer
$work   = $null
$srcAsar = $null
$srcUi   = $null

if ($isDir) {
    $srcAsar = Join-Path $packItem.FullName 'app.asar'
    $srcUi   = Join-Path $packItem.FullName 'ui'
    Info '输入是目录，直接使用'
} else {
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ('fbzh-pack-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    if ($DryRun) {
        Info "[DryRun] 会解包到 $work"
    } else {
        New-Item -ItemType Directory -Path $work -Force | Out-Null
        Expand-Archive -LiteralPath $packItem.FullName -DestinationPath $work -Force
        Ok "已解包到 $work"
    }
    $srcAsar = Join-Path $work 'app.asar'
    $srcUi   = Join-Path $work 'ui'
}

if (-not $DryRun) {
    if (-not (Test-Path -LiteralPath $srcAsar)) { Fail "汉化包里没有 app.asar（期望 $srcAsar）" }
    if (-not (Test-Path -LiteralPath (Join-Path $srcUi 'index.html'))) { Fail "汉化包里没有 ui\index.html（期望 $srcUi）" }
    Ok "app.asar $(Bytes (Get-Item -LiteralPath $srcAsar).Length) · ui\ 结构完整"
} else {
    Info '[DryRun] 跳过解包（版本戳直接从 zip 里读，下面照样校验）'
}

# 包版本（index.html 里的 <meta name="hanhua-pack">）——直接从 zip 里读，不解包，-DryRun 也能做版本校验
$packHtml = $null
if ($isDir) {
    $idxFile = Join-Path $packItem.FullName 'ui\index.html'
    if (Test-Path -LiteralPath $idxFile) { $packHtml = Get-Content -LiteralPath $idxFile -Raw -Encoding UTF8 }
} else {
    $packHtml = Read-ZipEntryText -Zip $packItem.FullName -Suffix 'ui/index.html'
}
$packVer = ''
if ($packHtml) {
    $m = [regex]::Match($packHtml, 'name="hanhua-pack"[^>]*content="([^"]*)"')
    if ($m.Success) { $packVer = $m.Groups[1].Value }
    $packLang = ([regex]::Match($packHtml, 'lang="([^"]*)"')).Groups[1].Value
    if ($packVer) { Ok "汉化包版本：$packVer（lang=`"$packLang`"）" } else { Warn '包里没有汉化包版本戳，可能不是本仓库的产物' }
    if ($packLang -and $packLang -ne 'zh-CN') { Warn "包内 index.html 的 lang=`"$packLang`"，不像汉化产物" }
} else {
    Warn '读不到包内 ui\index.html，无法确认包版本'
}

# ---- 版本匹配检查
Step '4/6' '版本匹配检查'
function Ver-Triplet {
    param([string]$s)
    if (-not $s) { return @(0,0,0) }
    $s = $s -replace '^[vV]',''
    $p = $s -split '[.\-+]'
    $r = @(0,0,0)
    for ($i = 0; $i -lt 3; $i++) { if ($i -lt $p.Count) { $n = 0; if ([int]::TryParse(($p[$i] -replace '\D',''), [ref]$n)) { $r[$i] = $n } } }
    return $r
}
$av = Ver-Triplet $appVer
$pv = Ver-Triplet $packVer
$avZero = ($av[0] -eq 0 -and $av[1] -eq 0 -and $av[2] -eq 0)
$pvZero = ($pv[0] -eq 0 -and $pv[1] -eq 0 -and $pv[2] -eq 0)
Info ("已装 Freebuff：{0}   汉化包适配：{1}" -f $(if ($avZero) { '读不到版本' } else { $av -join '.' }), $(if ($pvZero) { '读不到版本' } else { $pv -join '.' }))
if ($pvZero) {
    Warn '读不到汉化包版本，跳过匹配检查（自担风险）'
} elseif ($avZero) {
    Warn "读不到已装 Freebuff 的版本号（$dir\Freebuff.exe 没有版本信息），无法确认汉化包 $($pv -join '.') 是否匹配。"
    Warn '汉化包里是整个已汉化的 app.asar（含应用全部代码），版本不匹配时会把应用代码一起换掉。'
    if ($Force) { Warn '按 -Force 继续（版本未知）' }
    elseif ($DryRun) { Fail '体检结论：无法确认版本是否匹配，真实安装会被中止（要装就加 -Force）。' }
    else { Fail '无法确认版本是否匹配，已中止。确认要装就加 -Force。' }
} elseif (($av[0] -eq $pv[0]) -and ($av[1] -eq $pv[1]) -and ($av[2] -eq $pv[2])) {
    Ok '版本一致，可以安装'
} else {
    Warn '版本不一致！汉化包里是整个已汉化的 app.asar（含应用全部代码），'
    Warn "已装 Freebuff $($av -join '.')，汉化包适配 $($pv -join '.')：直接装会把应用代码换回 $($pv -join '.') 那一版。"
    Warn "正确做法：用适配 $($av -join '.') 的汉化包（仓库里 targetVersion 就是这个意思）。"
    if ($Force) { Warn '按 -Force 继续（版本不匹配）' }
    elseif ($DryRun) { Fail '体检结论：版本不匹配，真实安装会被中止（要装就加 -Force）。' }
    else { Fail '版本不匹配，已中止。确认要装就加 -Force。' }
}

# ---- 进程检查
Step '5/6' '确认 Freebuff 已退出'
Assert-AppClosed

# ---- 备份 + 安装
Step '6/6' '备份原版 → 安装汉化包'
$dstAsar = Join-Path $dir 'resources\app.asar'
$dstUi   = Join-Path $dir 'resources\orchestrator\ui'
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak     = Join-Path $dir "resources\hanhua-backup-$stamp"

if ($DryRun) {
    Info "[DryRun] 会备份 $dstAsar 与 $dstUi 到 $bak"
    Info "[DryRun] 会执行：Copy $srcAsar -> $dstAsar"
    Info "[DryRun] 会执行：Copy $srcUi\* -> $dstUi"
    Line ''
    Line '（体检模式结束，未做任何修改）'
    exit 0
}

New-Item -ItemType Directory -Path $bak -Force | Out-Null
Copy-Item -LiteralPath $dstAsar -Destination (Join-Path $bak 'app.asar') -Force
Copy-Item -LiteralPath $dstUi   -Destination (Join-Path $bak 'ui') -Recurse -Force
Ok "原版已备份到：$bak"
Info "备份大小：$(Bytes ((Get-ChildItem -LiteralPath $bak -Recurse -File | Measure-Object -Property Length -Sum).Sum))"

Copy-Item -LiteralPath $srcAsar -Destination $dstAsar -Force
Ok "app.asar 已写入（$(Bytes (Get-Item -LiteralPath $dstAsar).Length)）"

if (-not (Test-Path -LiteralPath $dstUi)) { New-Item -ItemType Directory -Path $dstUi -Force | Out-Null }
Copy-Item -Path (Join-Path $srcUi '*') -Destination $dstUi -Recurse -Force
Ok 'ui\ 已写入'

# ---- 校验
$after = Get-LocalizeState -Dir $dir
Line ''
Line '---------------- 安装结果 ----------------'
Info "安装目录：$dir"
Info "界面语言：lang=`"$($after.Lang)`"$(if ($after.Pack) { " · 汉化包 $($after.Pack)" })"
if ($after.Bundle) { Info "主 bundle：$($after.Bundle)（$(Bytes $after.BundleSize)，中文字符 $($after.Cjk) 个）" }
$pass = $true
if ($after.Lang -ne 'zh-CN') { Warn 'index.html 的 lang 不是 zh-CN'; $pass = $false }
if (-not $after.Pack)        { Warn 'index.html 里没有汉化包版本戳'; $pass = $false }
if ($after.Cjk -lt 1000)     { Warn "主 bundle 中文字符只有 $($after.Cjk) 个，疑似没替换上"; $pass = $false }
if ($pass) { Ok '校验通过：汉化已生效' } else { Warn '校验有异常，可用 -Restore 还原后再排查' }

# ---- 收尾
if ($work -and -not $KeepTemp -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }

Line ''
Line '---------------- 下一步 ----------------'
Line "  1) 启动 Freebuff（开始菜单或 $dir\Freebuff.exe），界面应为中文。"
Line "  2) 还原原版：.\install-freebuff-zh.ps1 -Restore"
Line "  3) 看状态：  .\install-freebuff-zh.ps1 -List"
Line "  4) 备份留在：$bak（脚本不会自动删）"
Line ''
Line '  注意：AI 回复的语言由 ~\.AGENTS.md 决定，汉化包只管界面文案。'
Line '        应用自动更新后会变回英文，重新跑一次本脚本即可。'
Line ''
