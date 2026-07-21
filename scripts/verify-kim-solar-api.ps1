# KIM 전구모델 일사량(dswrsfc) API 검증 스크립트 — 딱 1콜만 호출한다.
#
# 사전 조건: 기상청 API허브(apihub.kma.go.kr) 로그인 >
#            수치모델 > 6. 한국형수치예보모델(KIM) 자료 조회(NC, 8km) 활용신청
#
# 사용법:
#   .\scripts\verify-kim-solar-api.ps1                    # application-local.yml의 키 사용
#   .\scripts\verify-kim-solar-api.ps1 -Tmfc 2026070500 -Hf 3
param(
    [string]$AuthKey = "",
    [string]$Tmfc = "",     # KIM 실행시각 YYYYMMDDHH (UTC, 00/06/12/18시) — 생략 시 어제 00시
    [int]$Hf = 3            # 예측시간 (3의 배수; 03UTC=12KST 정오라 일사 확인에 적합)
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

if (-not $Tmfc) { $Tmfc = (Get-Date).AddDays(-1).ToString("yyyyMMdd") + "00" }

# 한반도 크롭 (KimNcGridParser.SUB_PARAM과 동일해야 한다)
$sub = "1482,1452,1596,1560"
$NX = 115; $NY = 109

$url = "https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-kim_nc_xy_txt2" +
       "?group=KIMG&nwp=NE57&data=U&name=dswrsfc&level=0&map=S&sub=$sub&sm=0&disp=A" +
       "&tmfc=$Tmfc&hf=$Hf&authKey=$AuthKey"
Write-Host "요청: tmfc=$Tmfc(UTC), hf=+${Hf}h, name=dswrsfc, sub=$sub"

$resp = Invoke-WebRequest -Uri $url -UseBasicParsing
$text = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())

if ($text -match '"status"\s*:\s*403' -or $text -match "활용신청") {
    Write-Host "`n[실패] 활용신청이 필요합니다:" -ForegroundColor Red
    Write-Host "  apihub.kma.go.kr > 수치모델 > 6. KIM 자료 조회(NC, 8km) 활용신청 후 재실행"
    exit 1
}
if ($text -match "# ERROR") {
    Write-Host "`n[실패] API 오류 응답:" -ForegroundColor Red
    Write-Host ($text.Substring(0, [Math]::Min(600, $text.Length)))
    exit 1
}

# 크기 echo 확인 (i = 115, j = 109)
if ($text -match "i\s*=\s*(\d+),\s*j\s*=\s*(\d+)") {
    Write-Host "응답 크롭 크기 : $($Matches[1]) x $($Matches[2]) (기대: $NX x $NY)"
}

# 헤더(#) 제외 숫자 토큰 수집
$values = New-Object System.Collections.Generic.List[double]
foreach ($line in $text -split "`n") {
    $line = $line.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { continue }
    foreach ($tok in ($line -split "\s+")) {
        $d = 0.0
        if ([double]::TryParse($tok, [ref]$d)) { $values.Add($d) }
    }
}

$expected = $NX * $NY
Write-Host "수신 값 개수 : $($values.Count) (기대: $expected)"
if ($values.Count -ne $expected) {
    Write-Host "[확인 필요] 값 개수가 다릅니다. 응답 앞부분:" -ForegroundColor Yellow
    Write-Host ($text.Substring(0, [Math]::Min(500, $text.Length)))
    exit 1
}

# 서울(126.97E, 37.57N) → 전구 i=1525, j=1531 → 크롭 (col 43, row 79) / 남쪽 행부터
$seoul = $values[79 * $NX + 43]
$stats = $values | Measure-Object -Minimum -Maximum -Average
Write-Host ("서울 일사량    : {0} W/m²" -f $seoul)
Write-Host ("영역 min/avg/max : {0:F1} / {1:F1} / {2:F1} W/m²" -f $stats.Minimum, $stats.Average, $stats.Maximum)
Write-Host "  (발효시각이 KST 야간이면 전체 0이 정상 — -Hf 3 은 12KST 정오)"

Write-Host "`n[성공] KIM 일사량 API 정상 — 분포도(발효시각당 1콜, 캐시 후 0콜)로 동작합니다." -ForegroundColor Green
