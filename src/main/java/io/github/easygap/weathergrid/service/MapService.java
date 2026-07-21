package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.*;
import io.github.easygap.weathergrid.exception.InvalidRequestException;
import io.github.easygap.weathergrid.exception.WeatherDataUnavailableException;
import io.github.easygap.weathergrid.util.CoordinateConverter;
import io.github.easygap.weathergrid.util.KimNcGridParser;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import org.springframework.beans.factory.annotation.Value;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 지도 표출 관련 비즈니스 로직
 *
 * 격자자료 API(nph-dfs_shrt_grd)로 전 격자를 변수당 1콜에 수신 →
 * 히트맵(WSD) + 스트림라인(UUU,VVV)을 총 3콜(캐시 적중 시 0콜)로 구성.
 * (기존 격자점별 getVilageFcst 병렬 호출 방식은 화면당 ~1,000콜이 발생해 폐기)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MapService {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final DateTimeFormatter WIND_TIME_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX");
    private static final DateTimeFormatter MODEL_RUN_TIME_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'");
    private static final DateTimeFormatter COMPACT_HOUR_FORMAT =
            DateTimeFormatter.ofPattern("yyyyMMddHH");
    private static final double MAX_WIND_COMPONENT = 150.0;
    private static final double MAX_WIND_SPEED = Math.sqrt(2.0) * MAX_WIND_COMPONENT;
    private static final double GRID_NO_DATA = -999.0;
    private static final Map<Integer, String> PRECIPITATION_TYPE_CATEGORIES = Map.of(
            0, "없음", 1, "비", 2, "비/눈", 3, "눈", 4, "소나기");
    private static final Map<Integer, String> SKY_CATEGORIES = Map.of(
            1, "맑음", 3, "구름많음", 4, "흐림");
    private static final Map<String, DfsElementDescriptor> DFS_SCALAR_ELEMENTS = Map.ofEntries(
            Map.entry("tmp", new DfsElementDescriptor(
                    "TMP", "°C", -100, 80, Map.of(), null,
                    "KMA DFS TMP", "temperature grid unavailable")),
            Map.entry("pcp", new DfsElementDescriptor(
                    "PCP", "mm", 0, 1_000, Map.of(), 1,
                    "KMA DFS PCP", "precipitation grid unavailable")),
            Map.entry("sno", new DfsElementDescriptor(
                    "SNO", "cm", 0, 100, Map.of(), 1,
                    "KMA DFS SNO", "snowfall grid unavailable")),
            Map.entry("pty", new DfsElementDescriptor(
                    "PTY", "code", 0, 0, PRECIPITATION_TYPE_CATEGORIES, null,
                    "KMA DFS PTY", "precipitation type grid unavailable")),
            Map.entry("reh", new DfsElementDescriptor(
                    "REH", "%", 0, 100, Map.of(), null,
                    "KMA DFS REH", "humidity grid unavailable")),
            Map.entry("sky", new DfsElementDescriptor(
                    "SKY", "code", 0, 0, SKY_CATEGORIES, null,
                    "KMA DFS SKY", "sky condition grid unavailable")),
            Map.entry("wav", new DfsElementDescriptor(
                    "WAV", "m", 0, 50, Map.of(), null,
                    "KMA DFS WAV", "wave height grid unavailable")));
    private static final Map<String, String> FORECAST_BACKED_STATION_LABELS = Map.of(
            "pcp", "강수량", "sno", "신적설", "pty", "강수형태",
            "reh", "상대습도", "sky", "하늘상태", "wav", "파고");

    private final KmaApiService kmaApiService;
    private final GridCacheService gridCacheService;
    // 단기예보 5km LCC 격자에서 한반도와 인접 해역을 포함하는 표출 범위.
    // 경계값은 CoordinateConverter의 공식 DFS 격자 변환 결과를 공유한다.
    private static final int NX_MIN = CoordinateConverter.FORECAST_NX_MIN;
    private static final int NX_MAX = CoordinateConverter.FORECAST_NX_MAX;
    private static final int NY_MIN = CoordinateConverter.FORECAST_NY_MIN;
    private static final int NY_MAX = CoordinateConverter.FORECAST_NY_MAX;

    /** 표출 다운샘플 간격 (1=5km 원해상도, 프론트 렌더 부하 시 2·4로 조정) */
    @Value("${weather-grid.grid.step:1}")
    private int gridStep;

    /** 운영 기본값은 false. 개발 데모에서만 명시적으로 합성 자료를 허용한다. */
    @Value("${weather-grid.demo-mode:false}")
    private boolean demoMode;

    /**
     * 메인 페이지 초기 데이터 조회
     */
    public Map<String, String> getLatestInfo() {
        String[] latestDateTime = kmaApiService.getLatestBaseDateTime();
        String baseDate = latestDateTime[0];
        String baseTime = latestDateTime[1];

        Map<String, String> info = new HashMap<>();
        info.put("baseDate", baseDate);
        info.put("baseTime", baseTime);
        info.put("fileName", baseDate + baseTime.substring(0, 2) + "_000");
        return info;
    }

    // ========== 예보시간 계산 ==========

    private String[] computeFcstDateTime(String baseDate, String baseTime, int leadHours) {
        int baseHour = Integer.parseInt(baseTime.substring(0, 2));
        LocalDateTime base = LocalDateTime.of(
                Integer.parseInt(baseDate.substring(0, 4)),
                Integer.parseInt(baseDate.substring(4, 6)),
                Integer.parseInt(baseDate.substring(6, 8)),
                baseHour, 0);
        LocalDateTime fcst = base.plusHours(leadHours);
        return new String[]{
                fcst.format(DateTimeFormatter.ofPattern("yyyyMMdd")),
                fcst.format(DateTimeFormatter.ofPattern("HHmm"))
        };
    }

    // ========== 통합 격자 조회 (히트맵 + 스트림라인 동시) ==========

    /**
     * 격자자료 API로 히트맵 + 스트림라인용 그리드 구성.
     * WSD/UUU/VVV 변수당 1콜 = 총 3콜, 캐시(메모리·디스크) 적중 시 0콜.
     */

    private record DfsScalarGridResult(double[][] grid,
                                       LocalDateTime modelRunKst,
                                       int modelForecastHour,
                                       boolean fallbackUsed) { }

    /** DFS 단일 요소의 물리 범위와 응답 메타데이터를 한곳에서 관리한다. */
    private record DfsElementDescriptor(String variable,
                                        String unit,
                                        double min,
                                        double max,
                                        Map<Integer, String> categories,
                                        Integer accumulationHours,
                                        String product,
                                        String unavailableMessage) {
        private boolean categorical() {
            return !categories.isEmpty();
        }

        private boolean valid(double value) {
            if (!Double.isFinite(value) || value <= -900 || value >= 9_000) return false;
            if (categorical()) {
                return value == Math.rint(value) && categories.containsKey((int) value);
            }
            return value >= min && value <= max;
        }
    }

    private record SolarGridResult(double[][] grid,
                                   LocalDateTime modelRunUtc,
                                   int modelForecastHour,
                                   LocalDateTime modelValidUtc,
                                   int temporalResolutionHours,
                                   boolean timeAdjusted,
                                   boolean fallbackUsed) { }

    private WeatherDataDto[][] fetchGridData(String baseDate, String baseTime, int leadHours) {
        // 잘못된 발표시각(구 UTC 체계 등) 방어 — 직전 유효 발표시각으로 보정
        String[] snapped = kmaApiService.snapToValidBaseDateTime(baseDate, baseTime);
        if (!snapped[0].equals(baseDate) || !snapped[1].equals(baseTime)) {
            log.info("발표시각 보정: {} {} → {} {}", baseDate, baseTime, snapped[0], snapped[1]);
            baseDate = snapped[0];
            baseTime = snapped[1];
        }

        String tmfc = baseDate + baseTime.substring(0, 2);

        // 단기예보 발효시각은 발표 +1시간부터 존재 → leadHours=0 요청은 +1h로 보정
        String[] fcstDt = computeFcstDateTime(baseDate, baseTime, Math.max(leadHours, 1));
        String tmef = fcstDt[0] + fcstDt[1].substring(0, 2);
        log.info("격자자료 조회: tmfc={}, tmef={} (leadHours={})", tmfc, tmef, leadHours);

        // 풍속은 표출용이지만 U/V 결측은 벡터장의 noData로 보존해야 한다.
        // 기본 조회의 0 치환을 사용하면 실제 무풍과 비관측 영역을 구분할 수 없다.
        double[][] wsd = gridCacheService.getGrid(tmfc, tmef, "WSD", -999.0);
        double[][] uuu = gridCacheService.getGrid(tmfc, tmef, "UUU", -999.0);
        double[][] vvv = gridCacheService.getGrid(tmfc, tmef, "VVV", -999.0);

        if (wsd == null && uuu == null && vvv == null) {
            return null;    // 호출부에서 mock 폴백
        }

        int gridNx = (NX_MAX - NX_MIN) / gridStep + 1;
        int gridNy = (NY_MAX - NY_MIN) / gridStep + 1;
        WeatherDataDto[][] grid = new WeatherDataDto[gridNy][gridNx];

        for (int yi = 0; yi < gridNy; yi++) {
            for (int xi = 0; xi < gridNx; xi++) {
                int nx = NX_MIN + xi * gridStep;    // 1-base 격자번호
                int ny = NY_MIN + yi * gridStep;
                double u = uuu != null ? uuu[ny - 1][nx - 1] : -999.0;
                double v = vvv != null ? vvv[ny - 1][nx - 1] : -999.0;
                boolean vectorValid = isValidWindComponent(u) && isValidWindComponent(v);
                double wsSource = wsd != null ? wsd[ny - 1][nx - 1] : -999.0;
                double ws = isValidWindSpeed(wsSource) ? wsSource
                        : vectorValid ? Math.hypot(u, v) : -999.0;
                grid[yi][xi] = WeatherDataDto.builder()
                        .windSpeed(ws)
                        .uWind(u)
                        .vWind(v)
                        .build();
            }
        }
        return grid;
    }

    // ========== 격자 데이터 (분포도/히트맵) ==========

    public Map<String, Object> getGridData(String baseDate, String baseTime,
                                           String element, int leadHours) {
        return buildGridData(baseDate, baseTime, element, leadHours, true);
    }

    /** 통계 전용 경로 — 전체 데이터 배열과 스트림라인 벡터장 생성을 생략한다. */
    public Map<String, Object> getDataStats(String baseDate, String baseTime,
                                            String element, int leadHours) {
        Map<String, Object> result = buildGridData(baseDate, baseTime, element, leadHours, false);
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("stats", result.get("stats"));
        if (result.containsKey("categoryCounts")) {
            stats.put("categoryCounts", result.get("categoryCounts"));
        }
        return stats;
    }

    private Map<String, Object> buildGridData(String baseDate, String baseTime,
                                               String element, int leadHours,
                                               boolean includePayload) {
        int gridNx = (NX_MAX - NX_MIN) / gridStep + 1;
        int gridNy = (NY_MAX - NY_MIN) / gridStep + 1;

        // 발표시각 보정을 먼저 수행 — 바람(fetchGridData 내부 재보정은 무해)과
        // 일사강도·기온·강수량(KIM 런/DFS 격자 매핑)이 같은 발표시각 기준을 쓰도록 한다
        String[] snapped = kmaApiService.snapToValidBaseDateTime(baseDate, baseTime);
        baseDate = snapped[0];
        baseTime = snapped[1];

        boolean isWind = "wdws".equals(element);
        DfsElementDescriptor scalarDescriptor = DFS_SCALAR_ELEMENTS.get(element);
        boolean mock = false;

        WeatherDataDto[][] grid = null;
        double[][] solar = null;
        SolarGridResult solarResult = null;
        double[][] scalarGrid = null;
        DfsScalarGridResult scalarResult = null;

        if (isWind) {
            grid = fetchGridData(baseDate, baseTime, leadHours);
            if (grid == null) {
                if (!demoMode) throw new WeatherDataUnavailableException("wind grid unavailable");
                log.warn("데모 모드: 격자자료 없음 - mock 데이터로 대체합니다.");
                grid = generateMockGrid(gridNx, gridNy);
                mock = true;
            }
        } else if (scalarDescriptor != null) {
            // 선택한 DFS 변수 하나만 조회한다. 0은 실값, 결측/범위 밖 값은 -999로 보존한다.
            scalarResult = fetchDfsScalarGrid(baseDate, baseTime, leadHours, scalarDescriptor);
            if (scalarResult == null) {
                if ("tmp".equals(element) && demoMode) {
                    log.warn("데모 모드: 기온 격자 없음 - mock 데이터로 대체합니다.");
                    mock = true;
                } else {
                    throw new WeatherDataUnavailableException(scalarDescriptor.unavailableMessage());
                }
            } else {
                scalarGrid = scalarResult.grid();
            }
        } else {
            if (!"swdn".equals(element)) throw new InvalidRequestException("잘못된 element");
            // 일사강도: 단기예보 격자에 없는 변수 → KIM 전구모델(dswrsfc, 8km)
            solarResult = fetchKimGrid(baseDate, baseTime, leadHours, "dswrsfc");
            solar = solarResult == null ? null : solarResult.grid();
            if (solar == null) {
                if (!demoMode) throw new WeatherDataUnavailableException("solar grid unavailable");
                log.warn("데모 모드: 일사강도 격자 없음 - mock 데이터로 대체합니다.");
                mock = true;
            }
        }

        LocalDateTime mockValidTime = mock && !isWind
                ? parseBaseDateTime(baseDate, baseTime).plusHours(Math.max(leadHours, 1))
                : null;

        List<Double> flatData = includePayload ? new ArrayList<>() : null;
        double min = Double.MAX_VALUE, max = -Double.MAX_VALUE, sum = 0;
        int count = 0;
        Map<Integer, Integer> categoryCounts = scalarDescriptor != null && scalarDescriptor.categorical()
                ? initializedCategoryCounts(scalarDescriptor.categories()) : null;

        for (int yi = gridNy - 1; yi >= 0; yi--) {
            for (int xi = 0; xi < gridNx; xi++) {
                double val = -999.0;
                if (isWind) {
                    if (grid[yi][xi] != null) val = grid[yi][xi].getWindSpeed();
                } else if (scalarDescriptor != null) {
                    if (scalarGrid != null) {
                        val = scalarGrid[(NY_MIN + yi * gridStep) - 1]
                                [(NX_MIN + xi * gridStep) - 1];
                        val = scalarDescriptor.valid(val) ? val : GRID_NO_DATA;
                    } else if ("tmp".equals(element) && mockValidTime != null) {
                        val = mockTemperature(NX_MIN + xi * gridStep,
                                NY_MIN + yi * gridStep, mockValidTime, leadHours);
                    }
                } else {
                    if (solar != null) {
                        // DFS 5km 셀 중심 위경도 → KIM 8km 크롭 격자 최근접 샘플
                        val = sampleSolar(solar, NX_MIN + xi * gridStep, NY_MIN + yi * gridStep);
                    } else if (mockValidTime != null) {
                        val = mockSolarRadiation(NX_MIN + xi * gridStep,
                                NY_MIN + yi * gridStep, mockValidTime, leadHours);
                    }
                }
                if (includePayload) flatData.add(val);
                // 0은 무풍·무강수·야간 일사강도·0℃에서 모두 실제 값이다. sentinel만 제외한다.
                boolean valid = Double.isFinite(val) && val > -900;
                if (valid) {
                    if (categoryCounts != null) {
                        categoryCounts.computeIfPresent((int) val, (ignored, current) -> current + 1);
                    }
                    min = Math.min(min, val);
                    max = Math.max(max, val);
                    sum += val;
                    count++;
                }
            }
        }

        if (count == 0) { min = 0; max = 0; }
        double avg = count > 0 ? sum / count : 0;

        Map<String, Object> result = new HashMap<>();
        if (categoryCounts != null) {
            Map<String, Object> categoricalStats = new LinkedHashMap<>();
            categoricalStats.put("min", null);
            categoricalStats.put("avg", null);
            categoricalStats.put("max", null);
            categoricalStats.put("count", count);
            result.put("stats", categoricalStats);
            result.put("categoryCounts", categoryCounts);
        } else {
            result.put("stats", MinMaxAvgDto.builder()
                    .min(Math.round(min * 10) / 10.0)
                    .avg(Math.round(avg * 10) / 10.0)
                    .max(Math.round(max * 10) / 10.0)
                    .build());
        }
        if (!includePayload) return result;

        double[] swLatLon = CoordinateConverter.gridToLatLon(NX_MIN, NY_MIN);
        // NE 코너는 실제 마지막 샘플 셀 기준 — step>1이면 NX_MAX/NY_MAX가 샘플에 포함되지 않을 수 있다
        double[] neLatLon = CoordinateConverter.gridToLatLon(lastSampledNx(), lastSampledNy());
        result.put("data", flatData);
        result.put("nx", gridNx);
        result.put("ny", gridNy);
        // 프론트가 화면 픽셀 → 공식 격자변환으로 셀을 직접 찾도록 서브그리드 정보 제공
        result.put("nxMin", NX_MIN);
        result.put("nyMin", NY_MIN);
        result.put("step", gridStep);
        result.put("baseDate", baseDate);
        result.put("baseTime", baseTime);
        result.put("swLat", swLatLon[0]);
        result.put("swLon", swLatLon[1]);
        result.put("neLat", neLatLon[0]);
        result.put("neLon", neLatLon[1]);
        result.put("mock", mock);    // API 미연결 데모 데이터 여부 (프론트 배지 표시)
        if (scalarResult != null) {
            LocalDateTime referenceTime = parseBaseDateTime(baseDate, baseTime);
            result.put("referenceTime", referenceTime.atZone(KST).format(WIND_TIME_FORMAT));
            result.put("validTime", referenceTime.plusHours(Math.max(leadHours, 1))
                    .atZone(KST).format(WIND_TIME_FORMAT));
            result.put("modelRunTime", scalarResult.modelRunKst().atZone(KST)
                    .withZoneSameInstant(ZoneOffset.UTC).format(MODEL_RUN_TIME_FORMAT));
            result.put("modelForecastHour", scalarResult.modelForecastHour());
            result.put("fallbackUsed", scalarResult.fallbackUsed());
            result.put("product", scalarDescriptor.product());
            result.put("unit", scalarDescriptor.unit());
            if (scalarDescriptor.accumulationHours() != null) {
                result.put("accumulationHours", scalarDescriptor.accumulationHours());
            }
            if (scalarDescriptor.categorical()) {
                result.put("categories", scalarDescriptor.categories());
            }
        } else if (solarResult != null) {
            LocalDateTime referenceTime = parseBaseDateTime(baseDate, baseTime);
            result.put("referenceTime", referenceTime.atZone(KST).format(WIND_TIME_FORMAT));
            result.put("requestedValidTime", referenceTime.plusHours(Math.max(leadHours, 1))
                    .atZone(KST).format(WIND_TIME_FORMAT));
            result.put("validTime", solarResult.modelValidUtc().atZone(ZoneOffset.UTC)
                    .withZoneSameInstant(KST).format(WIND_TIME_FORMAT));
            result.put("modelRunTime", solarResult.modelRunUtc().format(MODEL_RUN_TIME_FORMAT));
            result.put("modelForecastHour", solarResult.modelForecastHour());
            result.put("fallbackUsed", solarResult.fallbackUsed());
            result.put("temporalResolutionHours", solarResult.temporalResolutionHours());
            result.put("timeAdjusted", solarResult.timeAdjusted());
            result.put("product", "KIM NE57 dswrsfc");
        }

        // 스트림라인은 바람 요소에서만 생성 (일사·기온·강수량은 불필요)
        result.put("windField", isWind
                ? buildWindField(grid, gridNx, gridNy, baseDate, baseTime, leadHours)
                : null);

        return result;
    }

    // ========== 스트림라인 벡터장 생성 ==========

    /** 다운샘플 시 실제로 포함되는 마지막 격자 인덱스 (step=1이면 NX_MAX/NY_MAX 그대로) */
    private int lastSampledNx() {
        return NX_MIN + ((NX_MAX - NX_MIN) / gridStep) * gridStep;
    }

    private int lastSampledNy() {
        return NY_MIN + ((NY_MAX - NY_MIN) / gridStep) * gridStep;
    }

    /**
     * 화면과 3D가 함께 쓰는 KMA 벡터장 계약.
     *
     * U/V는 전송량을 줄이기 위해 0.1 m/s 단위 정수로 보관한다. 과거 호환용
     * GRIB 헤더는 실제 자료를 NCEP 700 hPa 데이터로 오인하게 만들었으므로 제거했다.
     */
    private Map<String, Object> buildWindField(WeatherDataDto[][] grid, int gridNx, int gridNy,
                                                 String baseDate, String baseTime,
                                                 int leadHours) {
        final int noData = -32768;
        int[] uData = new int[gridNx * gridNy];
        int[] vData = new int[gridNx * gridNy];
        int outputIndex = 0;
        for (int yi = gridNy - 1; yi >= 0; yi--) {
            for (int xi = 0; xi < gridNx; xi++) {
                WeatherDataDto cell = grid[yi][xi];
                if (cell != null
                        && isValidWindComponent(cell.getUWind())
                        && isValidWindComponent(cell.getVWind())) {
                    uData[outputIndex] = (int) Math.round(cell.getUWind() * 10);
                    vData[outputIndex] = (int) Math.round(cell.getVWind() * 10);
                } else {
                    uData[outputIndex] = noData;
                    vData[outputIndex] = noData;
                }
                outputIndex++;
            }
        }

        LocalDateTime reference = LocalDateTime.parse(
                baseDate + baseTime, DateTimeFormatter.ofPattern("yyyyMMddHHmm"));
        Map<String, Object> gridDefinition = new LinkedHashMap<>();
        gridDefinition.put("type", "kma-dfs-lcc");
        gridDefinition.put("nx", gridNx);
        gridDefinition.put("ny", gridNy);
        gridDefinition.put("nxMin", NX_MIN);
        gridDefinition.put("nyMin", NY_MIN);
        gridDefinition.put("step", gridStep);
        gridDefinition.put("rowOrder", "north-to-south");
        gridDefinition.put("columnOrder", "west-to-east");

        Map<String, Object> windField = new LinkedHashMap<>();
        windField.put("schema", "weather-grid.wind-field/v1");
        windField.put("unit", "m/s");
        windField.put("scaleFactor", 0.1);
        windField.put("noData", noData);
        // DFS UUU/VVV는 지구 기준 동·북 성분이다.
        windField.put("vectorReference", "earth-relative");
        int forecastHour = Math.max(leadHours, 1);
        windField.put("heightMeters", 10);
        windField.put("requestedForecastHour", leadHours);
        // 단기예보에는 발표 +0h 슬롯이 없어 화면의 +0h 요청도 +1h 자료를 사용한다.
        windField.put("forecastHour", forecastHour);
        windField.put("referenceTime", reference.atZone(KST).format(WIND_TIME_FORMAT));
        windField.put("validTime", reference.plusHours(forecastHour)
                .atZone(KST).format(WIND_TIME_FORMAT));
        windField.put("grid", gridDefinition);
        windField.put("u", uData);
        windField.put("v", vData);
        return windField;
    }

    private static boolean isValidWindComponent(double value) {
        return Double.isFinite(value) && Math.abs(value) <= MAX_WIND_COMPONENT;
    }

    private static boolean isValidWindSpeed(double value) {
        return Double.isFinite(value) && value >= 0.0 && value <= MAX_WIND_SPEED;
    }

    // ========== 지점 관련 ==========

    public List<double[]> getStationData(double latitude, double longitude,
                                          String baseDate, String baseTime,
                                          String element) {
        String forecastLabel = FORECAST_BACKED_STATION_LABELS.get(element);
        if (forecastLabel != null) {
            throw new InvalidRequestException(
                    forecastLabel + " 지점 시계열은 /api/weather/point-forecast를 사용해 주세요.");
        }
        // 잘못된 발표시각 방어 (분포도와 동일한 보정)
        String[] snapped = kmaApiService.snapToValidBaseDateTime(baseDate, baseTime);
        baseDate = snapped[0];
        baseTime = snapped[1];

        // 일사강도는 단기예보에 없는 변수 → KIM 전구모델 격자를 시간 슬롯별로 샘플링
        if ("swdn".equals(element)) {
            // KIM 크롭(≤40.0N) 밖 지점은 영구히 결측 — 재시도 의미가 없는 503 대신 400으로 끊는다
            if (KimNcGridParser.latLonToIndex(latitude, longitude) == null) {
                throw new InvalidRequestException("일사강도 지원 범위 밖 지점");
            }
            return ensureStationData(buildSolarTimeSeries(baseDate, baseTime, latitude, longitude));
        }

        int[] grid = CoordinateConverter.latLonToGrid(latitude, longitude);
        log.debug("위경도 ({}, {}) → 격자 ({}, {})", latitude, longitude, grid[0], grid[1]);

        List<StationDataDto> timeSeries = kmaApiService.getStationTimeSeries(
                baseDate, baseTime, grid[0], grid[1], element);

        if ("tmp".equals(element)) {
            return ensureStationData(backfillFirstSlot(timeSeries.stream()
                    .map(dto -> new double[]{dto.getTemperature(), 0})
                    .collect(Collectors.toList())));
        }
        return ensureStationData(backfillFirstSlot(timeSeries.stream()
                .map(dto -> new double[]{dto.getWindSpeed(), dto.getWindDirection()})
                .collect(Collectors.toList())));
    }

    private List<double[]> ensureStationData(List<double[]> series) {
        boolean hasValue = series.stream().anyMatch(slot -> slot != null && slot.length > 0
                && Double.isFinite(slot[0]) && slot[0] < 9000 && slot[0] > -900);
        if (!hasValue && !demoMode) throw new WeatherDataUnavailableException("station data unavailable");
        return series;
    }

    /**
     * 단기예보 조회 API는 발표 +1시간부터 제공되어 +0h 슬롯이 항상 결측('x')이다.
     * 분포도가 leadHours=0을 +1h로 보정해 그리는 것과 같은 규칙으로 첫 슬롯을 +1h 값으로 채운다.
     */
    private static List<double[]> backfillFirstSlot(List<double[]> series) {
        if (series.size() >= 2) {
            double v0 = series.get(0)[0], v1 = series.get(1)[0];
            if ((v0 >= 9000 || v0 <= -900) && v1 < 9000 && v1 > -900) {
                series.set(0, series.get(1).clone());
            }
        }
        return series;
    }

    // ========== 지표면 하향단파복사 강도 (KIM NE57 dswrsfc) ==========

    /**
     * 발표시각(KST) → KIM 전구모델 실행시각(UTC 00/06/12/18) 매핑
     * 선택 발표시각 직전의 런을 쓰므로 바람(단기예보)과 같은 "그 시점 기준 예보" 의미 유지
     */
    private LocalDateTime kimRunUtc(LocalDateTime baseKst) {
        LocalDateTime baseUtc = baseKst.minusHours(9);
        return baseUtc.withHour((baseUtc.getHour() / 6) * 6);
    }

    /** 선택 시각에 전체 예측장이 게시 완료된 최신 KIM 런을 고른다. */
    private LocalDateTime kimAvailableRunUtc(LocalDateTime baseKst) {
        LocalDateTime baseUtc = baseKst.minusHours(9);
        LocalDateTime run = kimRunUtc(baseKst);
        return java.time.Duration.between(run, baseUtc).toHours() < 5 ? run.minusHours(6) : run;
    }

    private static final DateTimeFormatter KIM_TMFC_FMT = DateTimeFormatter.ofPattern("yyyyMMddHH");
    private static final LocalDateTime KIM_HOURLY_START_UTC = LocalDateTime.of(2026, 7, 1, 0, 0);

    /**
     * 분포도용 KIM 전구모델 크롭 격자 조회 (현재 dswrsfc).
     * 2026-07-01 00UTC 런부터 +135h까지는 공식 1시간 자료를 그대로 사용한다.
     * 이전 런만 3시간 출력에 맞춰 최근접 시각으로 보정하며, 최신 런 미게시 시
     * 직전 런(-6h)을 한 번 조회한다.
     */
    private SolarGridResult fetchKimGrid(String baseDate, String baseTime, int leadHours, String name) {
        LocalDateTime baseKst = parseBaseDateTime(baseDate, baseTime);
        LocalDateTime validUtc = baseKst.plusHours(Math.max(leadHours, 1)).minusHours(9);
        LocalDateTime run = kimAvailableRunUtc(baseKst);

        for (int attempt = 0; attempt < 2; attempt++) {
            long hfExact = java.time.Duration.between(run, validUtc).toHours();
            int temporalResolutionHours = run.isBefore(KIM_HOURLY_START_UTC) ? 3 : 1;
            int hf = temporalResolutionHours == 1
                    ? (int) Math.max(0, hfExact)
                    : (int) Math.max(0, Math.round(hfExact / 3.0) * 3);
            double[][] grid = gridCacheService.getKimGrid(run.format(KIM_TMFC_FMT), hf, name);
            if (grid != null) {
                LocalDateTime modelValidUtc = run.plusHours(hf);
                return new SolarGridResult(grid, run, hf, modelValidUtc,
                        temporalResolutionHours, !modelValidUtc.equals(validUtc), attempt > 0);
            }
            run = run.minusHours(6);
        }
        return null;
    }

    private static Map<Integer, Integer> initializedCategoryCounts(Map<Integer, String> categories) {
        Map<Integer, Integer> counts = new LinkedHashMap<>();
        categories.keySet().stream().sorted().forEach(code -> counts.put(code, 0));
        return counts;
    }

    /** 공유 DFS 캐시를 읽기 전용으로 재사용하고 실제 표출 셀이 있는지만 확인한다. */
    private double[][] usableDfsScalarGrid(double[][] source,
                                           DfsElementDescriptor descriptor) {
        if (source == null || source.length < NY_MAX) return null;
        for (int y = NY_MIN - 1; y <= lastSampledNy() - 1; y += gridStep) {
            if (source[y] == null || source[y].length < NX_MAX) return null;
        }
        for (int y = NY_MIN - 1; y <= lastSampledNy() - 1; y += gridStep) {
            for (int x = NX_MIN - 1; x <= lastSampledNx() - 1; x += gridStep) {
                if (descriptor.valid(source[y][x])) return source;
            }
        }
        return null;
    }

    /** DFS 단일 요소 — 0을 유효값으로 유지하고 최신 런 결측 시 직전 3시간 런을 한 번 사용한다. */
    private DfsScalarGridResult fetchDfsScalarGrid(String baseDate, String baseTime,
                                                    int leadHours,
                                                    DfsElementDescriptor descriptor) {
        LocalDateTime requestedRun = parseBaseDateTime(baseDate, baseTime);
        LocalDateTime validTime = requestedRun.plusHours(Math.max(leadHours, 1));
        String tmef = validTime.format(COMPACT_HOUR_FORMAT);

        for (int attempt = 0; attempt < 2; attempt++) {
            LocalDateTime run = requestedRun.minusHours(attempt * 3L);
            String tmfc = run.format(COMPACT_HOUR_FORMAT);
            double[][] rawGrid = gridCacheService.getGrid(
                    tmfc, tmef, descriptor.variable(), GRID_NO_DATA);
            double[][] grid = usableDfsScalarGrid(rawGrid, descriptor);
            if (grid != null) {
                int modelForecastHour = (int) java.time.Duration.between(run, validTime).toHours();
                return new DfsScalarGridResult(grid, run, modelForecastHour, attempt > 0);
            }
        }
        return null;
    }

    /**
     * 지점 일사강도 49시간 시계열 (발표 +0~+48h).
     * 2026-07-01 이후에는 KIM의 실제 시간별 모델장을 사용하고, 이전 런만 공식
     * 3시간 간격에 맞춘다. +0h는 화면에서 숨기는 호환 슬롯이라 +1h로 채운다.
     */
    private List<double[]> buildSolarTimeSeries(String baseDate, String baseTime,
                                                double latitude, double longitude) {
        LocalDateTime baseKst = parseBaseDateTime(baseDate, baseTime);
        LocalDateTime baseUtc = baseKst.minusHours(9);
        LocalDateTime run = kimAvailableRunUtc(baseKst);

        int[] idx = KimNcGridParser.latLonToIndex(latitude, longitude);
        java.util.Map<Integer, double[][]> gridByHf = new java.util.HashMap<>();

        // 가장 먼 발효시각까지 게시됐는지 한 번 확인하고, 미완료면 직전 런으로 통일한다.
        int lastHf = kimForecastHour(run, baseUtc.plusHours(48));
        double[][] lastGrid = gridCacheService.getKimGrid(run.format(KIM_TMFC_FMT), lastHf, "dswrsfc");
        if (lastGrid == null) {
            run = run.minusHours(6);
            lastHf = kimForecastHour(run, baseUtc.plusHours(48));
            lastGrid = gridCacheService.getKimGrid(run.format(KIM_TMFC_FMT), lastHf, "dswrsfc");
        }
        gridByHf.put(lastHf, lastGrid);
        String tmfc = run.format(KIM_TMFC_FMT);

        List<double[]> series = new ArrayList<>(49);
        for (int h = 0; h <= 48; h++) {
            double val = 9999;    // 프론트 결측 sentinel
            if (idx != null) {
                int visibleHour = Math.max(h, 1);
                int hf = kimForecastHour(run, baseUtc.plusHours(visibleHour));
                double[][] grid;
                if (gridByHf.containsKey(hf)) {
                    grid = gridByHf.get(hf);
                } else {
                    grid = gridCacheService.getKimGrid(tmfc, hf, "dswrsfc");
                    gridByHf.put(hf, grid);
                }
                if (grid != null) val = normalizeSolar(grid[idx[0]][idx[1]]);
            }
            series.add(new double[]{val, 0});
        }
        return series;
    }

    private int kimForecastHour(LocalDateTime runUtc, LocalDateTime validUtc) {
        long exact = Math.max(0, java.time.Duration.between(runUtc, validUtc).toHours());
        return runUtc.isBefore(KIM_HOURLY_START_UTC)
                ? (int) Math.max(0, Math.round(exact / 3.0) * 3)
                : (int) exact;
    }

    /** DFS 격자셀(nx, ny) 중심 위경도의 KIM 크롭 격자 최근접 값 */
    private double sampleSolar(double[][] solar, int nx, int ny) {
        double[] ll = CoordinateConverter.gridToLatLon(nx, ny);
        int[] idx = KimNcGridParser.latLonToIndex(ll[0], ll[1]);
        return idx != null ? normalizeSolar(solar[idx[0]][idx[1]]) : KimNcGridParser.NO_DATA;
    }

    /** 하향단파복사의 야간 미세 음수는 모델 수치 잡음이며, 결측 sentinel은 보존한다. */
    private static double normalizeSolar(double value) {
        return Double.isFinite(value) && value > -900 ? Math.max(0, value) : value;
    }

    private LocalDateTime parseBaseDateTime(String baseDate, String baseTime) {
        return LocalDateTime.of(
                Integer.parseInt(baseDate.substring(0, 4)),
                Integer.parseInt(baseDate.substring(4, 6)),
                Integer.parseInt(baseDate.substring(6, 8)),
                Integer.parseInt(baseTime.substring(0, 2)), 0);
    }

    // ========== Mock 데이터 (API 사용 불가 시 테스트용) ==========

    /** API 키 없이 실행하는 로컬 데모에서도 계절·시각·공간 변화가 읽히는 기온장. */
    private double mockTemperature(int nx, int ny, LocalDateTime validTime, int leadHours) {
        double[] ll = CoordinateConverter.gridToLatLon(nx, ny);
        double lat = ll[0];
        double lon = ll[1];
        double seasonal = 13.5 + 12.0 * Math.sin(
                2 * Math.PI * (validTime.getDayOfYear() - 109) / 365.25);
        double diurnal = 4.2 * Math.cos(
                2 * Math.PI * (validTime.getHour() - 15) / 24.0);
        double latitudeGradient = -0.72 * (lat - 36.0);
        double synoptic = 1.8 * Math.sin((lon - 126.4) * 0.85 + (lat - 35.5) * 0.45 + leadHours * 0.08);
        return Math.round((seasonal + diurnal + latitudeGradient + synoptic) * 10) / 10.0;
    }

    /** 태양고도와 완만한 구름 패턴을 반영한 로컬 데모용 하향단파복사 강도장. */
    private double mockSolarRadiation(int nx, int ny, LocalDateTime validTime, int leadHours) {
        double[] ll = CoordinateConverter.gridToLatLon(nx, ny);
        double latRad = Math.toRadians(ll[0]);
        double declination = Math.toRadians(23.44)
                * Math.sin(2 * Math.PI * (284 + validTime.getDayOfYear()) / 365.0);
        double solarHour = validTime.getHour() + validTime.getMinute() / 60.0;
        double hourAngle = Math.toRadians(15 * (solarHour - 12.5));
        double sinElevation = Math.sin(latRad) * Math.sin(declination)
                + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
        if (sinElevation <= 0) return 0;

        double cloudFactor = 0.76 + 0.14 * Math.sin(
                ll[1] * 1.7 + ll[0] * 0.8 + leadHours * 0.17);
        double radiation = 1080 * Math.pow(sinElevation, 1.2) * cloudFactor;
        return Math.round(Math.max(0, radiation));
    }

    private WeatherDataDto[][] generateMockGrid(int gridNx, int gridNy) {
        WeatherDataDto[][] grid = new WeatherDataDto[gridNy][gridNx];
        Random rand = new Random(42);
        for (int yi = 0; yi < gridNy; yi++) {
            for (int xi = 0; xi < gridNx; xi++) {
                // 한반도 형태의 바람 패턴 시뮬레이션
                double lat = 32.0 + (yi / (double) gridNy) * 6.0;  // 32~38도
                double lon = 124.8 + (xi / (double) gridNx) * 6.8; // 124.8~131.6도

                // 서풍 계열 + 위도/경도 변화
                double uBase = 2.0 + Math.sin(lat * 0.5) * 3.0 + rand.nextGaussian() * 0.5;
                double vBase = -1.0 + Math.cos(lon * 0.3) * 2.0 + rand.nextGaussian() * 0.5;
                double wsd = Math.sqrt(uBase * uBase + vBase * vBase);
                double vec = (Math.toDegrees(Math.atan2(-uBase, -vBase)) + 360) % 360;

                // 바다 영역 (동해, 서해 끝) 마스킹
                boolean isLand = (lon > 125.5 && lon < 130.5 && lat > 33.0 && lat < 38.5)
                        || (lon > 125.0 && lat > 34.0 && lat < 37.0);
                if (!isLand) {
                    wsd *= 1.5; // 바다는 풍속 더 셈
                }

                grid[yi][xi] = WeatherDataDto.builder()
                        .windSpeed(Math.round(wsd * 10) / 10.0)
                        .windDirection(Math.round(vec * 10) / 10.0)
                        .uWind(Math.round(uBase * 10) / 10.0)
                        .vWind(Math.round(vBase * 10) / 10.0)
                        .build();
            }
        }
        return grid;
    }

    // ========== 내부 헬퍼 ==========

}
