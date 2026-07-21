package io.github.easygap.weathergrid.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import io.github.easygap.weathergrid.dto.StationDataDto;
import io.github.easygap.weathergrid.dto.WeatherDataDto;
import io.github.easygap.weathergrid.util.KimNcGridParser;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 기상청 API Hub (apihub.kma.go.kr) 연동 서비스
 *
 * 사용 API:
 * 1. 단기예보 격자 (nph-dfs_shrt_grd) — 분포도·스트림라인용 전 격자 (변수당 1콜)
 * 2. 단기예보 조회 (VilageFcstInfoService_2.0/getVilageFcst) — 지점 49시간 시계열
 * 3. KIM 전구 NC (nph-kim_nc_xy_txt2) — 지표면 하향단파복사(dswrsfc), 한반도 크롭
 *
 * 공통 정책: 403은 2분 쿨다운(영구 래치 금지 — 트래픽 제한 403 대비).
 * DFS는 5km LCC 149×253 격자를 사용한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class KmaApiService {

    private final WebClient kmaWebClient;
    private final ObjectMapper objectMapper;

    @Value("${kma.api.auth-key}")
    private String authKey;

    // ========== 0. 단기예보 격자자료 조회 (전 격자 1콜) ==========

    /**
     * 403 응답 시 반복 호출을 잠시 멈추는 쿨다운.
     *
     * API허브는 미신청 키뿐 아니라 순간 트래픽 제한에도 403을 반환한다.
     * 영구 래치로 두면 일시적 403 한 번에 재시작 전까지 API 경로 전체가
     * 죽으므로(시계열 중간 슬롯부터 전부 결측이 되는 형태), 쿨다운 후
     * 재개하도록 한다. 미신청 키라면 쿨다운이 끝날 때마다 한 번씩만
     * 재확인하는 비용으로 수렴한다.
     */
    private static final long API_DENY_COOLDOWN_MS = 120_000;
    private volatile long gridApiDeniedUntil = 0;

    private static boolean inCooldown(long until) {
        return System.currentTimeMillis() < until;
    }

    /**
     * 데모·테스트 실행에서는 인증키를 비워 둘 수 있다. 이 상태에서 원점까지
     * 접속하면 실패가 확정된 요청마다 타임아웃을 기다리게 되므로 즉시 폴백한다.
     */
    private boolean hasAuthKey() {
        return authKey != null && !authKey.isBlank();
    }

    /**
     * 업스트림 호출 실패 로그용 예외 요약.
     * WebClientResponseException 메시지에는 요청 URL(authKey 포함)이 그대로 들어가므로
     * 예외 객체를 통째로 로거에 넘기지 않고, 키를 가린 한 줄 요약만 남긴다.
     */
    private String describeError(Throwable e) {
        String msg = e.getMessage() != null ? e.getMessage() : "";
        if (authKey != null && !authKey.isBlank()) {
            msg = msg.replace(authKey, "***");
        }
        return e.getClass().getSimpleName() + ": " + msg;
    }

    /**
     * 단기예보 격자자료 조회 - 변수 하나의 전 격자(149×253) 데이터를 한 번에 반환
     *
     * 기존 getVilageFcst(격자점 1개씩 조회)로 분포도를 만들면 화면당 ~1,000콜이
     * 필요해 일일 한도가 즉시 소진됨 → 이 API는 변수당 1콜로 전 구역을 받는다.
     *
     * 발표시각: 02, 05, 08, 11, 14, 17, 20, 23시 / 발효시각: 1시간 단위
     *
     * @param tmfc 발표시각 (YYYYMMDDHH)
     * @param tmef 발효시각 (YYYYMMDDHH)
     * @param vars 예보변수 (WSD, VEC, UUU, VVV, TMP, REH, ...)
     * @return 격자 텍스트 원문 ('#' 헤더 + 값 나열) / 실패·미신청 시 null
     */
    public String fetchShortTermGridRaw(String tmfc, String tmef, String vars) {
        if (!hasAuthKey()) return null;
        if (inCooldown(gridApiDeniedUntil)) return null;

        try {
            String response = kmaWebClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/api/typ01/cgi-bin/url/nph-dfs_shrt_grd")
                            .queryParam("tmfc", tmfc)
                            .queryParam("tmef", tmef)
                            .queryParam("vars", vars)
                            .queryParam("authKey", authKey)
                            .build())
                    .retrieve()
                    .bodyToMono(String.class)
                    .block(java.time.Duration.ofSeconds(30));

            if (response == null) return null;

            // 미신청 키에 대한 403 JSON 응답 감지
            if (response.contains("\"status\" : 403") || response.contains("활용신청")) {
                gridApiDeniedUntil = System.currentTimeMillis() + API_DENY_COOLDOWN_MS;
                log.error("격자자료 API 403 (활용신청 필요 또는 일시적 트래픽 제한): "
                        + "apihub.kma.go.kr > 예특보 > 단기예보 > 격자자료(nph-dfs_shrt_grd) "
                        + "활용신청 여부를 확인하세요. 2분간 호출을 건너뜁니다.");
                return null;
            }
            return response;
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";
            if (msg.contains("403") || msg.contains("Forbidden")) {
                gridApiDeniedUntil = System.currentTimeMillis() + API_DENY_COOLDOWN_MS;
                log.error("격자자료 API 403 Forbidden — 2분간 호출을 건너뜁니다.");
            } else {
                log.error("격자자료 API 호출 실패: tmfc={}, tmef={}, vars={}, cause={}", tmfc, tmef, vars, describeError(e));
            }
            return null;
        }
    }

    // ========== 0-1. KIM 전구모델 NC 조회 (하향단파복사 등 단기예보 미제공 변수) ==========

    /** KIM NC 403 쿨다운 — 위 gridApiDeniedUntil과 동일한 정책 */
    private volatile long kimApiDeniedUntil = 0;

    /**
     * KIM 전구모델(NE57, 8km) 단일면 변수 조회 - 한반도 크롭 영역 1콜
     *
     * 단기예보 격자자료(nph-dfs_shrt_grd)에는 해당 변수가 없어
     * KIM 전구모델 후처리 자료의 dswrsfc(지표면 하향단파복사 플럭스, W/m²)를 사용한다.
     * 전구 전체는 122MB이므로 map=S + sub(한반도 크롭)로 165KB만 수신.
     *
     * 실행시각: 00, 06, 12, 18 UTC. 2026-07-01 00UTC 런부터 +1~+135h는
     * 1시간 간격이며, 이전 런은 기존 3시간 간격이다.
     *
     * @param tmfc 실행(분석)시각 UTC (YYYYMMDDHH)
     * @param hf   예측시간(시간). 2026-07-01 이후 런은 1시간 단위
     * @param name 변수명 (dswrsfc 등 — KIM 8km 변수정보 문서 참고, 대소문자 구분)
     * @return 크롭 격자 텍스트 원문 / 실패·미신청 시 null
     */
    public String fetchKimNcGridRaw(String tmfc, int hf, String name) {
        if (!hasAuthKey()) return null;
        if (inCooldown(kimApiDeniedUntil)) return null;

        try {
            String response = kmaWebClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/api/typ01/cgi-bin/url/nph-kim_nc_xy_txt2")
                            .queryParam("group", "KIMG")
                            .queryParam("nwp", "NE57")
                            .queryParam("data", "U")
                            .queryParam("name", name)
                            .queryParam("level", 0)
                            .queryParam("map", "S")
                            .queryParam("sub", KimNcGridParser.SUB_PARAM)
                            .queryParam("sm", 0)
                            .queryParam("disp", "A")
                            .queryParam("tmfc", tmfc)
                            .queryParam("hf", hf)
                            .queryParam("authKey", authKey)
                            .build())
                    .retrieve()
                    .bodyToMono(String.class)
                    .block(java.time.Duration.ofSeconds(30));

            if (response == null) return null;

            if (response.contains("\"status\" : 403") || response.contains("활용신청")) {
                kimApiDeniedUntil = System.currentTimeMillis() + API_DENY_COOLDOWN_MS;
                log.error("KIM NC 조회 API 403 (활용신청 필요 또는 일시적 트래픽 제한): "
                        + "apihub.kma.go.kr > 수치모델 > 6. KIM 자료 조회(NC, 8km) "
                        + "활용신청 여부를 확인하세요. 2분간 호출을 건너뜁니다.");
                return null;
            }
            return response;
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";
            if (msg.contains("403") || msg.contains("Forbidden")) {
                kimApiDeniedUntil = System.currentTimeMillis() + API_DENY_COOLDOWN_MS;
                log.error("KIM NC 조회 API 403 Forbidden — 2분간 호출을 건너뜁니다.");
            } else {
                log.error("KIM NC 조회 API 호출 실패: tmfc={}, hf={}, name={}, cause={}", tmfc, hf, name, describeError(e));
            }
            return null;
        }
    }

    // ========== 1. 단기예보 조회 ==========

    /**
     * 단기예보 조회 - 특정 격자점의 전체 예보 데이터
     * 용도: 지점 클릭 시 49시간 시계열 차트, 격자 데이터 조회
     *
     * 발표시각: 0200, 0500, 0800, 1100, 1400, 1700, 2000, 2300
     * 예보시간: 발표시각 기준 +1시간부터. 요소별 제공 슬롯은 실제 응답을 기준으로 병합
     *
     * @param baseDate 발표일자 (YYYYMMDD)
     * @param baseTime 발표시각 (HHMM) - 0200, 0500, 0800, 1100, 1400, 1700, 2000, 2300
     * @param nx       격자 X 좌표 (1~149)
     * @param ny       격자 Y 좌표 (1~253)
     * @return 예보 데이터 리스트 (카테고리별 시간별)
     */
    private volatile long vilageApiDeniedUntil = 0;

    public List<WeatherDataDto> getShortTermForecast(String baseDate, String baseTime, int nx, int ny) {
        List<WeatherDataDto> dataList = new ArrayList<>();

        if (!hasAuthKey()) return dataList;
        // 403 쿨다운 중이면 불필요한 호출 방지
        if (inCooldown(vilageApiDeniedUntil)) return dataList;

        try {
            String response = kmaWebClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst")
                            .queryParam("pageNo", 1)
                            .queryParam("numOfRows", 1000)
                            .queryParam("dataType", "JSON")
                            .queryParam("base_date", baseDate)
                            .queryParam("base_time", baseTime)
                            .queryParam("nx", nx)
                            .queryParam("ny", ny)
                            .queryParam("authKey", authKey)
                            .build())
                    .retrieve()
                    .bodyToMono(String.class)
                    .block(java.time.Duration.ofSeconds(10));

            if (response != null) {
                // API Hub 403 응답 체크 (JSON 형태로 403 반환하는 경우)
                if (response.contains("\"status\" : 403") || response.contains("활용신청")) {
                    if (!inCooldown(vilageApiDeniedUntil)) {
                        vilageApiDeniedUntil = System.currentTimeMillis() + API_DENY_COOLDOWN_MS;
                        log.error("단기예보 조회 API 403 — 2분간 호출을 건너뜁니다.");
                    }
                    return dataList;
                }
                dataList = parseVilageFcstResponse(response);
            }
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";
            if (msg.contains("403") || msg.contains("Forbidden")) {
                if (!inCooldown(vilageApiDeniedUntil)) {
                    vilageApiDeniedUntil = System.currentTimeMillis() + API_DENY_COOLDOWN_MS;
                    log.error("단기예보 조회 API 403 — 2분간 호출을 건너뜁니다.");
                }
            } else {
                log.debug("단기예보 API 호출 실패: nx={}, ny={}", nx, ny);
            }
        }

        return dataList;
    }

    // ========== 지점 시계열 데이터 조회 (49시간) ==========

    /**
     * 단기예보 기반 시계열 데이터 조회
     * 특정 격자점(nx, ny)에 대해 0~48시간 예보 데이터를 조회
     *
     * @param baseDate 발표일자
     * @param baseTime 발표시각
     * @param nx       격자 X
     * @param ny       격자 Y
     * @param element  요소 (wdws: 풍향풍속, swdn: 일사강도)
     * @return 시계열 데이터 리스트 (최대 49개)
     */
    /** 지점 시계열 캐시 — 같은 발표시각·격자점 재클릭 시 API 재호출 방지 */
    private final Map<String, List<StationDataDto>> stationCache = new ConcurrentHashMap<>();
    private static final int STATION_CACHE_MAX = 200;

    public List<StationDataDto> getStationTimeSeries(String baseDate, String baseTime,
                                                     int nx, int ny, String element) {
        // 파싱 결과에 풍속·풍향·일사가 모두 담기므로 element는 캐시 키에서 제외
        String cacheKey = baseDate + baseTime + "_" + nx + "_" + ny;
        List<StationDataDto> cached = stationCache.get(cacheKey);
        if (cached != null) {
            log.debug("지점 시계열 캐시 적중: {}", cacheKey);
            return cached;
        }

        // 단기예보 API로 해당 격자점 데이터 조회
        List<WeatherDataDto> forecastData = getShortTermForecast(baseDate, baseTime, nx, ny);

        // 예보시간별로 그룹핑 (fcstDate + fcstTime)
        Map<String, WeatherDataDto> mergedByTime = new LinkedHashMap<>();
        for (WeatherDataDto dto : forecastData) {
            String timeKey = dto.getFcstDate() + dto.getFcstTime();
            WeatherDataDto merged = mergedByTime.computeIfAbsent(timeKey, k ->
                    WeatherDataDto.builder()
                            .baseDate(baseDate)
                            .baseTime(baseTime)
                            .fcstDate(dto.getFcstDate())
                            .fcstTime(dto.getFcstTime())
                            // 0은 정온·북풍·0℃에서 모두 유효하다. 카테고리가 아직
                            // 도착하지 않은 상태는 외부 응답 계약의 결측값으로 구분한다.
                            .windSpeed(9999)
                            .windDirection(9999)
                            .uWind(9999)
                            .vWind(9999)
                            .solarRadiation(9999)
                            .temperature(9999)
                            .build());
            // 카테고리별 값 병합
            if (Double.isFinite(dto.getWindSpeed())) merged.setWindSpeed(dto.getWindSpeed());
            if (Double.isFinite(dto.getWindDirection())) merged.setWindDirection(dto.getWindDirection());
            if (Double.isFinite(dto.getUWind())) merged.setUWind(dto.getUWind());
            if (Double.isFinite(dto.getVWind())) merged.setVWind(dto.getVWind());
            if (Double.isFinite(dto.getSolarRadiation())) merged.setSolarRadiation(dto.getSolarRadiation());
            if (Double.isFinite(dto.getTemperature())) merged.setTemperature(dto.getTemperature());
        }

        // 발효시각 오프셋 기준으로 정확히 49슬롯(발표 +0~+48시간)에 매핑
        // 프론트 차트는 data[i] = 발표시각 + i시간(1시간 간격, 9999=결측)을 가정한다.
        // 단기예보는 +1h부터 제공되므로 슬롯 0은 결측(9999)이 정상이며,
        // 순번대로 채우면 전체가 1시간씩 밀리고 48h 초과분이 차트를 깨뜨린다.
        LocalDateTime base = LocalDateTime.of(
                Integer.parseInt(baseDate.substring(0, 4)),
                Integer.parseInt(baseDate.substring(4, 6)),
                Integer.parseInt(baseDate.substring(6, 8)),
                Integer.parseInt(baseTime.substring(0, 2)), 0);
        DateTimeFormatter keyFmt = DateTimeFormatter.ofPattern("yyyyMMddHHmm");

        StationDataDto[] slots = new StationDataDto[49];
        for (Map.Entry<String, WeatherDataDto> entry : mergedByTime.entrySet()) {
            LocalDateTime fcst;
            try {
                fcst = LocalDateTime.parse(entry.getKey(), keyFmt);
            } catch (Exception e) {
                continue;
            }
            long offset = java.time.Duration.between(base, fcst).toHours();
            if (offset < 0 || offset > 48) continue;    // 차트 표시 범위 밖은 버림

            WeatherDataDto data = entry.getValue();
            slots[(int) offset] = StationDataDto.builder()
                    .forecastHour((int) offset)
                    .windSpeed(data.getWindSpeed())
                    .windDirection(data.getWindDirection())
                    .solarRadiation(data.getSolarRadiation())
                    .temperature(data.getTemperature())
                    .fcstDateTime(entry.getKey())
                    .build();
        }

        List<StationDataDto> timeSeriesData = new ArrayList<>(49);
        for (int h = 0; h < 49; h++) {
            timeSeriesData.add(slots[h] != null ? slots[h]
                    : StationDataDto.builder()
                            .forecastHour(h)
                            .windSpeed(9999)
                            .windDirection(9999)
                            .solarRadiation(9999)
                            .temperature(9999)
                            .build());
        }

        // 유효 데이터만 캐시 (API 실패로 빈 응답이면 다음 클릭 때 재시도)
        if (!mergedByTime.isEmpty()) {
            if (stationCache.size() >= STATION_CACHE_MAX) stationCache.clear();
            stationCache.put(cacheKey, timeSeriesData);
        }

        return timeSeriesData;
    }

    // ========== 5. 최신 발표시각 계산 ==========

    /**
     * 현재 시각 기준 최신 단기예보 발표시각 계산
     * 단기예보 발표시각: 0200, 0500, 0800, 1100, 1400, 1700, 2000, 2300
     * 발표 후 약 10분 뒤 데이터 사용 가능
     *
     * @return [baseDate, baseTime] 배열
     */
    public String[] getLatestBaseDateTime() {
        LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Seoul"));
        int hour = now.getHour();
        int minute = now.getMinute();

        // 단기예보 발표시각 (내림차순)
        int[] baseTimes = {23, 20, 17, 14, 11, 8, 5, 2};
        String baseTime = "0200";
        LocalDateTime baseDateTime = now;

        for (int bt : baseTimes) {
            // 발표시각 + 10분 이후부터 사용 가능
            if (hour > bt || (hour == bt && minute >= 10)) {
                baseTime = String.format("%02d00", bt);
                baseDateTime = now.withHour(bt).withMinute(0);
                break;
            }
        }

        // 현재 시각이 02:10 이전이면 전날 23시 발표 데이터
        if (hour < 2 || (hour == 2 && minute < 10)) {
            baseDateTime = now.minusDays(1).withHour(23).withMinute(0);
            baseTime = "2300";
        }

        String baseDate = baseDateTime.format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        return new String[]{baseDate, baseTime};
    }

    /**
     * 임의의 (발표일자, 발표시각)을 직전 유효 발표시각(02,05,...,23시)으로 보정
     *
     * 프론트 구버전 시간체계(UTC 00/06/12/18) 등 잘못된 발표시각 요청 방어용.
     * 존재하지 않는 발표시각으로 격자자료를 조회하면 전체 -99 응답이 반환되어
     * 빈 화면 + 무의미한 API 콜이 발생한다.
     *
     * @return [baseDate, baseTime(HHMM)] — 이미 유효하면 입력 그대로
     */
    public String[] snapToValidBaseDateTime(String baseDate, String baseTime) {
        int hour;
        try {
            hour = Integer.parseInt(baseTime.substring(0, 2));
        } catch (Exception e) {
            log.warn("발표시각 형식 오류({}) — 최신 발표시각으로 대체", baseTime);
            return getLatestBaseDateTime();
        }

        if (hour >= 2 && (hour - 2) % 3 == 0) {
            return new String[]{baseDate, String.format("%02d00", hour)};    // 이미 유효
        }

        java.time.LocalDate date;
        try {
            date = java.time.LocalDate.parse(baseDate, DateTimeFormatter.ofPattern("yyyyMMdd"));
        } catch (Exception e) {
            log.warn("발표일자 형식 오류({}) — 최신 발표시각으로 대체", baseDate);
            return getLatestBaseDateTime();
        }

        int snapped;
        if (hour < 2) {         // 00, 01시 → 전날 23시 발표분
            date = date.minusDays(1);
            snapped = 23;
        } else {                 // 그 외 → 직전 발표시각
            snapped = 2 + 3 * ((hour - 2) / 3);
        }
        return new String[]{date.format(DateTimeFormatter.ofPattern("yyyyMMdd")),
                String.format("%02d00", snapped)};
    }

    // ========== 내부 파싱 메서드 ==========

    /**
     * 단기예보/초단기예보 JSON 응답 파싱
     * 응답 구조: response > body > items > item[]
     *
     * 각 item:
     * {
     *   "baseDate": "20260327",
     *   "baseTime": "0200",
     *   "category": "WSD",     // WSD, VEC, UUU, VVV, TMP 등
     *   "fcstDate": "20260327",
     *   "fcstTime": "0600",
     *   "fcstValue": "3.2",
     *   "nx": 60,
     *   "ny": 127
     * }
     */
    private List<WeatherDataDto> parseVilageFcstResponse(String response) {
        List<WeatherDataDto> dataList = new ArrayList<>();

        try {
            JsonNode root = objectMapper.readTree(response);

            // 응답 코드 확인
            JsonNode header = root.path("response").path("header");
            String resultCode = header.path("resultCode").asText("");
            if (!"00".equals(resultCode)) {
                log.warn("API 응답 오류: resultCode={}, resultMsg={}",
                        resultCode, header.path("resultMsg").asText(""));
                return dataList;
            }

            JsonNode items = root.path("response").path("body").path("items").path("item");
            if (items.isMissingNode() || !items.isArray()) {
                log.warn("API 응답에 items 없음");
                return dataList;
            }

            for (JsonNode item : items) {
                String category = item.path("category").asText("");
                String fcstValue = item.path("fcstValue").asText(null);
                String fcstDate = item.path("fcstDate").asText("");
                String fcstTime = item.path("fcstTime").asText("");
                int nx = item.path("nx").asInt(0);
                int ny = item.path("ny").asInt(0);

                double value;
                try {
                    if (fcstValue == null || fcstValue.isBlank()) continue;
                    value = Double.parseDouble(fcstValue);
                    if (!Double.isFinite(value)) continue;
                } catch (NumberFormatException e) {
                    continue;
                }

                WeatherDataDto dto = WeatherDataDto.builder()
                        .baseDate(item.path("baseDate").asText(""))
                        .baseTime(item.path("baseTime").asText(""))
                        .fcstDate(fcstDate)
                        .fcstTime(fcstTime)
                        .nx(nx)
                        .ny(ny)
                        // primitive double의 기본 0과 "이 카테고리가 아님"을 구분한다.
                        // 아래 switch가 선택한 한 필드만 실제 값(0 포함)으로 바꾼다.
                        .windSpeed(Double.NaN)
                        .windDirection(Double.NaN)
                        .uWind(Double.NaN)
                        .vWind(Double.NaN)
                        .solarRadiation(Double.NaN)
                        .temperature(Double.NaN)
                        .build();

                // 카테고리별 값 매핑
                switch (category) {
                    case "WSD" -> dto.setWindSpeed(value);                   // 풍속 (m/s)
                    case "VEC" -> dto.setWindDirection(value);               // 풍향 (deg)
                    case "UUU" -> dto.setUWind(value);                       // 동서바람 (m/s)
                    case "VVV" -> dto.setVWind(value);                       // 남북바람 (m/s)
                    case "TMP", "T1H" -> dto.setTemperature(value);         // 기온 (°C)
                    default -> { continue; }  // 불필요한 카테고리 스킵
                }

                dataList.add(dto);
            }
        } catch (Exception e) {
            log.error("단기예보 응답 파싱 실패", e);
        }

        return dataList;
    }
}
