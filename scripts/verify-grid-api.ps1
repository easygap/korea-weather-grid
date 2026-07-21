# 단기예보 격자자료 API 검증 스크립트 — 딱 1콜만 호출한다.
#
# 사전 조건: 기상청 API허브(apihub.kma.go.kr) 로그인 >
#            예특보 > 단기예보 > 격자자료(nph-dfs_shrt_grd) 활용신청
#
# 사용법:
#   .\scripts\verify-grid-api.ps1                # application-local.yml의 키 사용
#   .\scripts\verify-grid-api.ps1 -Tmfc 2026070402 -Vars WSD
param(
    [string]$AuthKey = "",
    [string]$Tmfc = "",     # 발표시각 YYYYMMDDHH (02,05,08,11,14,17,20,23시) — 생략 시 오늘 02시
    [string]$Vars = "WSD"
)

$ErrorActionPreference = "Stop"

# authKey: 파라미터 > application-local.yml
if (-not $AuthKey) {
    $localYml = Join-Path $PSScriptRoot "..\src\main\resources\application-local.yml"
    if (Test-Path $localYml) {
        $m = Select-String -Path $localYml -Pattern "auth-key:\s*(\S+)" | Select-Object -First 1
        if ($m) { $AuthKey = $m.Matches[0].Groups[1].Value }
    }
}
if (-not $AuthKey) { Write-Error "auth-key를 찾을 수 없습니다. -AuthKey 로 지정하세요."; exit 1 }

if (-not $Tmfc) { $Tmfc = (Get-Date).ToString("yyyyMMdd") + "02" }
$tmef = ([datetime]::ParseExact($Tmfc, "yyyyMMddHH", $null)).AddHours(10).ToString("yyyyMMddHH")

$url = "https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-dfs_shrt_grd?tmfc=$Tmfc&tmef=$tmef&vars=$Vars&authKey=$AuthKey"
Write-Host "요청: tmfc=$Tmfc, tmef=$tmef, vars=$Vars"

$resp = Invoke-WebRequest -Uri $url -UseBasicParsing
$text = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())

if ($text -match '"status"\s*:\s*403' -or $text -match "활용신청") {
    Write-Host "`n[실패] 활용신청이 필요합니다:" -ForegroundColor Red
    Write-Host "  apihub.kma.go.kr > 예특보 > 단기예보 > 격자자료 활용신청 후 재실행"
    exit 1
}

# 헤더(#) 제외하고 숫자 토큰 수집
$values = New-Object System.Collections.Generic.List[double]
foreach ($line in $text -split "`n") {
    $line = $line.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { continue }
    foreach ($tok in ($line -split "[,\s]+")) {
        $d = 0.0
        if ([double]::TryParse($tok, [ref]$d)) { $values.Add($d) }
    }
}

$NX = 149; $NY = 253; $expected = $NX * $NY
Write-Host "`n수신 값 개수 : $($values.Count) (기대: $expected)"
if ($values.Count -ne $expected) {
    Write-Host "[확인 필요] 값 개수가 다릅니다. 응답 앞부분:" -ForegroundColor Yellow
    Write-Host ($text.Substring(0, [Math]::Min(500, $text.Length)))
    exit 1
}

# 격자 방향 판별용 샘플 — 서울 격자(60,127)는 육지라 유효값이어야 정상
function Get-Cell([int]$nx, [int]$ny, [bool]$southFirst) {
    $row = if ($southFirst) { $ny - 1 } else { $NY - $ny }
    return $values[$row * $NX + ($nx - 1)]
}
Write-Host ("서울(60,127)   남쪽우선 가정: {0,8}   북쪽우선 가정: {1,8}" -f (Get-Cell 60 127 $true), (Get-Cell 60 127 $false))
Write-Host ("부산(98,76)    남쪽우선 가정: {0,8}   북쪽우선 가정: {1,8}" -f (Get-Cell 98 76 $true), (Get-Cell 98 76 $false))
Write-Host "`n두 지점 모두 '남쪽우선' 열에서 정상 값(-99 아님)이면 현재 파서 설정 그대로 사용."
Write-Host "'북쪽우선' 열만 정상이면 DfsGridParser.FIRST_ROW_IS_SOUTH = false 로 변경."
Write-Host "`n[성공] 격자자료 API 정상 — 서버 실행 시 화면당 3콜(캐시 후 0콜)로 동작합니다." -ForegroundColor Green