package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.MinMaxAvgDto;
import io.github.easygap.weathergrid.exception.WeatherDataUnavailableException;
import io.github.easygap.weathergrid.util.KimNcGridParser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MapServiceWindFieldTest {

    private static final int DFS_NX = 149;
    private static final int DFS_NY = 253;
    private static final int FIELD_NX = 145;
    private static final int FIELD_NY = 162;

    @Mock
    private KmaApiService kmaApiService;

    @Mock
    private GridCacheService gridCacheService;

    private MapService mapService;
    private String baseDate;

    @BeforeEach
    void setUp() {
        mapService = new MapService(kmaApiService, gridCacheService);
        ReflectionTestUtils.setField(mapService, "gridStep", 1);
        ReflectionTestUtils.setField(mapService, "demoMode", false);
        baseDate = LocalDate.now(ZoneId.of("Asia/Seoul")).minusDays(1)
                .format(DateTimeFormatter.BASIC_ISO_DATE);
        lenient().when(kmaApiService.snapToValidBaseDateTime(baseDate, "0200"))
                .thenReturn(new String[]{baseDate, "0200"});
        lenient().when(kmaApiService.snapToValidBaseDateTime(baseDate, "1400"))
                .thenReturn(new String[]{baseDate, "1400"});
    }

    @Test
    void tenMeterFieldPreservesVectorNoDataAndReportsActualSourceHour() {
        double[][] speed = filledGrid(DFS_NY, DFS_NX, 2.6);
        double[][] u = filledGrid(DFS_NY, DFS_NX, 1.2);
        double[][] v = filledGrid(DFS_NY, DFS_NX, -2.3);

        // 응답 배열의 첫 셀은 북쪽 첫 행(DFS ny=162), 서쪽 첫 열(nx=5)이다.
        // 풍속은 유효하지만 U가 결측이면 히트맵은 유지하고 벡터만 noData여야 한다.
        u[161][4] = -999.0;
        speed[161][5] = 9999.0;
        u[161][6] = 151.0;
        u[161][7] = 9999.0;
        speed[161][8] = 9999.0;
        u[161][8] = -999.0;
        v[161][8] = -999.0;
        speed[161][9] = 0.0;
        when(gridCacheService.getGrid(anyString(), anyString(), eq("WSD"), eq(-999.0))).thenReturn(speed);
        when(gridCacheService.getGrid(anyString(), anyString(), eq("UUU"), eq(-999.0))).thenReturn(u);
        when(gridCacheService.getGrid(anyString(), anyString(), eq("VVV"), eq(-999.0))).thenReturn(v);

        Map<String, Object> result = mapService.getGridData(baseDate, "0200", "wdws", 0);
        Map<String, Object> field = windField(result);
        Map<String, Object> grid = objectMap(field.get("grid"));
        int[] encodedU = intArray(field.get("u"));
        int[] encodedV = intArray(field.get("v"));

        assertEquals("weather-grid.wind-field/v1", field.get("schema"));
        assertEquals("m/s", field.get("unit"));
        assertEquals(0.1, field.get("scaleFactor"));
        assertEquals(-32768, field.get("noData"));
        assertEquals("earth-relative", field.get("vectorReference"));
        assertEquals(10, field.get("heightMeters"));
        assertEquals(0, field.get("requestedForecastHour"));
        assertEquals(1, field.get("forecastHour"));
        assertEquals(kstTime(0), field.get("referenceTime"));
        assertEquals(kstTime(1), field.get("validTime"));

        assertEquals("kma-dfs-lcc", grid.get("type"));
        assertEquals(FIELD_NX, grid.get("nx"));
        assertEquals(FIELD_NY, grid.get("ny"));
        assertEquals(5, grid.get("nxMin"));
        assertEquals(1, grid.get("nyMin"));
        assertEquals(1, grid.get("step"));
        assertEquals("north-to-south", grid.get("rowOrder"));
        assertEquals("west-to-east", grid.get("columnOrder"));

        assertEquals(FIELD_NX * FIELD_NY, encodedU.length);
        assertEquals(encodedU.length, encodedV.length);
        assertEquals(-32768, encodedU[0]);
        assertEquals(-32768, encodedV[0]);
        assertEquals(12, encodedU[1]);
        assertEquals(-23, encodedV[1]);
        assertEquals(-32768, encodedU[2]);
        assertEquals(-32768, encodedV[2]);
        assertEquals(-32768, encodedU[3]);
        assertEquals(-32768, encodedV[3]);
        assertEquals(2.6, doubleList(result.get("data")).get(0));
        assertEquals(Math.hypot(1.2, -2.3), doubleList(result.get("data")).get(1), 1e-12);
        assertEquals(-999.0, doubleList(result.get("data")).get(4));
        assertEquals(0.0, doubleList(result.get("data")).get(5));
        assertEquals(0.0, ((MinMaxAvgDto) result.get("stats")).getMin());

        verify(gridCacheService).getGrid(anyString(), anyString(), eq("WSD"), eq(-999.0));
        verify(gridCacheService).getGrid(anyString(), anyString(), eq("UUU"), eq(-999.0));
        verify(gridCacheService).getGrid(anyString(), anyString(), eq("VVV"), eq(-999.0));
    }

    @Test
    void nonWindPayloadUsesNullInsteadOfAStringSentinel() {
        double[][] temperature = filledGrid(DFS_NY, DFS_NX, 18.5);
        when(gridCacheService.getGrid(anyString(), anyString(), eq("TMP"), eq(-999.0)))
                .thenReturn(temperature);

        Map<String, Object> result = mapService.getGridData(baseDate, "0200", "tmp", 1);

        assertTrue(result.containsKey("windField"));
        assertNull(result.get("windField"));
        LocalDateTime requestedRun = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE)
                .atTime(2, 0);
        assertEquals(kstTime(requestedRun), result.get("referenceTime"));
        assertEquals(kstTime(requestedRun.plusHours(1)), result.get("validTime"));
        assertEquals(modelRunTime(requestedRun), result.get("modelRunTime"));
        assertEquals(1, result.get("modelForecastHour"));
        assertEquals(false, result.get("fallbackUsed"));
    }

    @Test
    void temperatureFourteenRunKeepsFifteenValidTimeAndFallsBackToEleven() {
        double[][] temperature = filledGrid(DFS_NY, DFS_NX, 8.0);
        when(gridCacheService.getGrid(baseDate + "14", baseDate + "15", "TMP", -999.0))
                .thenReturn(null);
        when(gridCacheService.getGrid(baseDate + "11", baseDate + "15", "TMP", -999.0))
                .thenReturn(temperature);

        Map<String, Object> result = mapService.getGridData(baseDate, "1400", "tmp", 1);

        LocalDateTime requestedRun = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE)
                .atTime(14, 0);
        LocalDateTime actualRun = requestedRun.minusHours(3);
        assertEquals(8.0, doubleList(result.get("data")).get(0));
        assertEquals(baseDate, result.get("baseDate"));
        assertEquals("1400", result.get("baseTime"));
        assertEquals(kstTime(requestedRun), result.get("referenceTime"));
        assertEquals(kstTime(requestedRun.plusHours(1)), result.get("validTime"));
        assertEquals(modelRunTime(actualRun), result.get("modelRunTime"));
        assertEquals(4, result.get("modelForecastHour"));
        assertEquals(true, result.get("fallbackUsed"));
        InOrder calls = inOrder(gridCacheService);
        calls.verify(gridCacheService).getGrid(baseDate + "14", baseDate + "15", "TMP", -999.0);
        calls.verify(gridCacheService).getGrid(baseDate + "11", baseDate + "15", "TMP", -999.0);
        verifyNoMoreInteractions(gridCacheService);
    }

    @Test
    void temperatureTwoRunCrossesMidnightToPreviousTwentyThreeWithSameValidTime() {
        double[][] temperature = filledGrid(DFS_NY, DFS_NX, 8.0);
        String previousDate = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE).minusDays(1)
                .format(DateTimeFormatter.BASIC_ISO_DATE);
        when(gridCacheService.getGrid(baseDate + "02", baseDate + "03", "TMP", -999.0))
                .thenReturn(null);
        when(gridCacheService.getGrid(previousDate + "23", baseDate + "03", "TMP", -999.0))
                .thenReturn(temperature);

        Map<String, Object> result = mapService.getGridData(baseDate, "0200", "tmp", 1);

        LocalDateTime requestedRun = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE)
                .atTime(2, 0);
        LocalDateTime actualRun = requestedRun.minusHours(3);
        assertEquals(8.0, doubleList(result.get("data")).get(0));
        assertEquals(kstTime(requestedRun.plusHours(1)), result.get("validTime"));
        assertEquals(modelRunTime(actualRun), result.get("modelRunTime"));
        assertEquals(4, result.get("modelForecastHour"));
        assertEquals(true, result.get("fallbackUsed"));
        InOrder calls = inOrder(gridCacheService);
        calls.verify(gridCacheService).getGrid(baseDate + "02", baseDate + "03", "TMP", -999.0);
        calls.verify(gridCacheService).getGrid(previousDate + "23", baseDate + "03", "TMP", -999.0);
        verifyNoMoreInteractions(gridCacheService);
    }

    @Test
    void temperatureStopsAfterLatestAndOnePreviousRunBothFail() {
        WeatherDataUnavailableException error = assertThrows(WeatherDataUnavailableException.class,
                () -> mapService.getGridData(baseDate, "1400", "tmp", 1));

        assertEquals("temperature grid unavailable", error.getMessage());
        InOrder calls = inOrder(gridCacheService);
        calls.verify(gridCacheService).getGrid(baseDate + "14", baseDate + "15", "TMP", -999.0);
        calls.verify(gridCacheService).getGrid(baseDate + "11", baseDate + "15", "TMP", -999.0);
        verifyNoMoreInteractions(gridCacheService);
    }

    @Test
    void postCutoverSolarUsesExactHourlyFieldAndPublishesSourceTimes() {
        double[][] solar = filledGrid(KimNcGridParser.NY, KimNcGridParser.NX, -0.03);
        for (int row = 0; row < solar.length; row++) {
            for (int col = (row & 1); col < solar[row].length; col += 2) {
                solar[row][col] = KimNcGridParser.NO_DATA;
            }
        }
        LocalDateTime run = expectedKimRun();
        LocalDateTime baseKst = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE)
                .atTime(2, 0);
        LocalDateTime requestedValidUtc = baseKst.plusHours(2).minusHours(9);
        int exactHf = (int) Duration.between(run, requestedValidUtc).toHours();
        when(gridCacheService.getKimGrid(run.format(DateTimeFormatter.ofPattern("yyyyMMddHH")),
                exactHf, "dswrsfc")).thenReturn(solar);

        Map<String, Object> result = mapService.getGridData(baseDate, "0200", "swdn", 2);
        List<Double> data = doubleList(result.get("data"));
        MinMaxAvgDto stats = (MinMaxAvgDto) result.get("stats");

        assertTrue(data.contains(KimNcGridParser.NO_DATA));
        assertTrue(data.contains(0.0));
        assertTrue(data.stream().allMatch(value -> value == KimNcGridParser.NO_DATA || value >= 0));
        assertEquals(0.0, stats.getMin());
        assertEquals(0.0, stats.getAvg());
        assertEquals(0.0, stats.getMax());
        assertEquals(kstTime(baseKst), result.get("referenceTime"));
        assertEquals(kstTime(baseKst.plusHours(2)), result.get("requestedValidTime"));
        assertEquals(kstTime(baseKst.plusHours(2)), result.get("validTime"));
        assertEquals(run.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'")),
                result.get("modelRunTime"));
        assertEquals(exactHf, result.get("modelForecastHour"));
        assertEquals(1, result.get("temporalResolutionHours"));
        assertEquals(false, result.get("timeAdjusted"));
        assertEquals(false, result.get("fallbackUsed"));
        assertEquals("KIM NE57 dswrsfc", result.get("product"));
        assertNull(result.get("windField"));
        verify(gridCacheService).getKimGrid(
                run.format(DateTimeFormatter.ofPattern("yyyyMMddHH")), exactHf, "dswrsfc");
    }

    @Test
    void postCutoverSolarStationSeriesKeepsAllFortyEightHourlyModelSlots() {
        when(gridCacheService.getKimGrid(anyString(), anyInt(), eq("dswrsfc")))
                .thenAnswer(invocation -> repeatedRows(
                        KimNcGridParser.NY, KimNcGridParser.NX,
                        ((Integer) invocation.getArgument(1)).doubleValue()));

        List<double[]> series = mapService.getStationData(
                37.5665, 126.9780, baseDate, "0200", "swdn");

        LocalDateTime run = expectedKimRun();
        LocalDateTime baseUtc = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE)
                .atTime(2, 0).minusHours(9);
        int firstHf = (int) Duration.between(run, baseUtc.plusHours(1)).toHours();
        int lastHf = (int) Duration.between(run, baseUtc.plusHours(48)).toHours();
        assertEquals(49, series.size());
        assertEquals(firstHf, series.get(0)[0]);
        assertEquals(firstHf, series.get(1)[0]);
        for (int hour = 2; hour <= 48; hour++) {
            assertEquals(firstHf + hour - 1, series.get(hour)[0],
                    "2026-07-01 이후 KIM 시간별 슬롯이 3시간 단위로 중복되면 안 된다");
        }

        ArgumentCaptor<Integer> hf = ArgumentCaptor.forClass(Integer.class);
        verify(gridCacheService, times(48)).getKimGrid(
                eq(run.format(DateTimeFormatter.ofPattern("yyyyMMddHH"))),
                hf.capture(), eq("dswrsfc"));
        List<Integer> requested = hf.getAllValues();
        assertEquals(lastHf, requested.get(0), "먼 발효시각 게시 여부를 먼저 확인한다");
        assertEquals(firstHf, requested.get(1));
        assertEquals(lastHf - 1, requested.get(requested.size() - 1));
        assertEquals(48, requested.stream().distinct().count());
    }

    @Test
    void demoModeBuildsTemperatureGridWhenUpstreamIsUnavailable() {
        ReflectionTestUtils.setField(mapService, "demoMode", true);

        Map<String, Object> result = mapService.getGridData(baseDate, "0200", "tmp", 1);
        List<Double> data = doubleList(result.get("data"));
        MinMaxAvgDto stats = (MinMaxAvgDto) result.get("stats");

        assertEquals(FIELD_NX * FIELD_NY, data.size());
        assertTrue(data.stream().allMatch(value -> Double.isFinite(value) && value > -900));
        assertTrue(stats.getMax() > stats.getMin());
        assertEquals(true, result.get("mock"));
        assertNull(result.get("windField"));
    }

    @Test
    void demoModeBuildsDaylightSolarGridWhenUpstreamIsUnavailable() {
        ReflectionTestUtils.setField(mapService, "demoMode", true);

        Map<String, Object> result = mapService.getGridData(baseDate, "0200", "swdn", 10);
        List<Double> data = doubleList(result.get("data"));
        MinMaxAvgDto stats = (MinMaxAvgDto) result.get("stats");

        assertEquals(FIELD_NX * FIELD_NY, data.size());
        assertTrue(data.stream().allMatch(value -> Double.isFinite(value) && value >= 0));
        assertTrue(stats.getMax() > 0);
        assertEquals(true, result.get("mock"));
        assertNull(result.get("windField"));
    }

    private String kstTime(int offsetHours) {
        LocalDateTime reference = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE).atTime(2, 0);
        return kstTime(reference.plusHours(offsetHours));
    }

    private String kstTime(LocalDateTime time) {
        return time.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")) + "+09:00";
    }

    private String modelRunTime(LocalDateTime runKst) {
        return runKst.atZone(ZoneId.of("Asia/Seoul"))
                .withZoneSameInstant(ZoneOffset.UTC)
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'"));
    }

    private LocalDateTime expectedKimRun() {
        LocalDateTime baseUtc = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE)
                .atTime(2, 0).minusHours(9);
        LocalDateTime run = baseUtc.withHour((baseUtc.getHour() / 6) * 6);
        return Duration.between(run, baseUtc).toHours() < 5 ? run.minusHours(6) : run;
    }

    private static double[][] filledGrid(int rows, int columns, double value) {
        double[][] grid = new double[rows][columns];
        for (double[] row : grid) Arrays.fill(row, value);
        return grid;
    }

    private static double[][] repeatedRows(int rows, int columns, double value) {
        double[] row = new double[columns];
        Arrays.fill(row, value);
        double[][] grid = new double[rows][];
        Arrays.fill(grid, row);
        return grid;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> windField(Map<String, Object> result) {
        Object value = result.get("windField");
        assertTrue(value instanceof Map<?, ?>);
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> objectMap(Object value) {
        assertTrue(value instanceof Map<?, ?>);
        return (Map<String, Object>) value;
    }

    private static int[] intArray(Object value) {
        assertTrue(value instanceof int[]);
        return (int[]) value;
    }

    @SuppressWarnings("unchecked")
    private static List<Double> doubleList(Object value) {
        assertTrue(value instanceof List<?>);
        return (List<Double>) value;
    }
}
