package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.MinMaxAvgDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MapServiceScalarGridTest {

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
        org.mockito.Mockito.lenient().when(kmaApiService.snapToValidBaseDateTime(baseDate, "0200"))
                .thenReturn(new String[]{baseDate, "0200"});
    }

    @Test
    void selectedScalarElementFetchesOnlyItsOwnDfsVariableAndPublishesMetadata() {
        Map<String, ScalarCase> cases = new LinkedHashMap<>();
        cases.put("sno", new ScalarCase("SNO", 2.4, "KMA DFS SNO", "cm", 1));
        cases.put("pty", new ScalarCase("PTY", 4, "KMA DFS PTY", "code", null));
        cases.put("reh", new ScalarCase("REH", 75, "KMA DFS REH", "%", null));
        cases.put("sky", new ScalarCase("SKY", 3, "KMA DFS SKY", "code", null));
        cases.put("wav", new ScalarCase("WAV", 1.8, "KMA DFS WAV", "m", null));
        when(gridCacheService.getGrid(anyString(), anyString(), anyString(), eq(-999.0)))
                .thenAnswer(invocation -> filledGrid(cases.values().stream()
                        .filter(value -> value.variable().equals(invocation.getArgument(2)))
                        .findFirst().orElseThrow().value()));

        for (Map.Entry<String, ScalarCase> entry : cases.entrySet()) {
            ScalarCase expected = entry.getValue();
            Map<String, Object> result = mapService.getGridData(
                    baseDate, "0200", entry.getKey(), 1);

            assertEquals(expected.product(), result.get("product"));
            assertEquals(expected.unit(), result.get("unit"));
            assertEquals(expected.accumulationHours(), result.get("accumulationHours"));
            assertTrue(doubleList(result.get("data")).stream()
                    .allMatch(value -> value == expected.value()));
        }

        ArgumentCaptor<String> variable = ArgumentCaptor.forClass(String.class);
        verify(gridCacheService, org.mockito.Mockito.times(cases.size()))
                .getGrid(eq(baseDate + "02"), eq(baseDate + "03"), variable.capture(), eq(-999.0));
        assertEquals(cases.values().stream().map(ScalarCase::variable).toList(),
                variable.getAllValues());
        verifyNoMoreInteractions(gridCacheService);
    }

    @Test
    void categoricalElementsReturnCountsWithoutNumericAverages() {
        when(gridCacheService.getGrid(baseDate + "02", baseDate + "03", "PTY", -999.0))
                .thenReturn(filledGrid(4));
        when(gridCacheService.getGrid(baseDate + "02", baseDate + "03", "SKY", -999.0))
                .thenReturn(filledGrid(3));

        Map<String, Map<Integer, Integer>> expectedCounts = Map.of(
                "pty", Map.of(0, 0, 1, 0, 2, 0, 3, 0, 4, FIELD_NX * FIELD_NY),
                "sky", Map.of(1, 0, 3, FIELD_NX * FIELD_NY, 4, 0));
        for (Map.Entry<String, Map<Integer, Integer>> expected : expectedCounts.entrySet()) {
            Map<String, Object> result = mapService.getGridData(
                    baseDate, "0200", expected.getKey(), 1);
            Map<String, Object> stats = objectMap(result.get("stats"));
            Map<Integer, Integer> counts = integerMap(result.get("categoryCounts"));

            assertNull(stats.get("min"));
            assertNull(stats.get("avg"));
            assertNull(stats.get("max"));
            assertEquals(FIELD_NX * FIELD_NY, stats.get("count"));
            assertEquals(expected.getValue(), counts);

            Map<String, Object> statsOnly = mapService.getDataStats(
                    baseDate, "0200", expected.getKey(), 1);
            assertEquals(stats, statsOnly.get("stats"));
            assertEquals(counts, statsOnly.get("categoryCounts"));
        }
    }

    @Test
    void scalarDescriptorNormalizesSentinelsAndOutOfRangeValuesWithoutMutatingCache() {
        double[][] humidity = filledGrid(60);
        // 응답 첫 셀은 DFS ny=162,nx=5다.
        humidity[161][4] = 9999;
        humidity[161][5] = -999;
        humidity[161][6] = 101;
        humidity[161][7] = 0;
        humidity[161][8] = 100;
        when(gridCacheService.getGrid(baseDate + "02", baseDate + "03", "REH", -999.0))
                .thenReturn(humidity);

        Map<String, Object> result = mapService.getGridData(baseDate, "0200", "reh", 1);
        List<Double> data = doubleList(result.get("data"));
        MinMaxAvgDto stats = (MinMaxAvgDto) result.get("stats");

        assertEquals(List.of(-999.0, -999.0, -999.0, 0.0, 100.0), data.subList(0, 5));
        assertEquals(0.0, stats.getMin());
        assertEquals(100.0, stats.getMax());
        assertEquals(9999.0, humidity[161][4], "공유 캐시 격자는 변경하지 않는다");
    }

    @Test
    void allInvalidLatestRunFallsBackOnceAndKeepsRequestedValidTime() {
        when(kmaApiService.snapToValidBaseDateTime(baseDate, "1400"))
                .thenReturn(new String[]{baseDate, "1400"});
        when(gridCacheService.getGrid(baseDate + "14", baseDate + "15", "SNO", -999.0))
                .thenReturn(filledGrid(9999));
        when(gridCacheService.getGrid(baseDate + "11", baseDate + "15", "SNO", -999.0))
                .thenReturn(filledGrid(2));

        Map<String, Object> result = mapService.getGridData(baseDate, "1400", "sno", 1);

        assertEquals(true, result.get("fallbackUsed"));
        assertEquals(4, result.get("modelForecastHour"));
        assertEquals(baseDate.substring(0, 4) + "-" + baseDate.substring(4, 6) + "-"
                + baseDate.substring(6, 8) + "T15:00:00+09:00", result.get("validTime"));
        assertTrue(doubleList(result.get("data")).stream().allMatch(value -> value == 2));

        InOrder calls = inOrder(gridCacheService);
        calls.verify(gridCacheService).getGrid(baseDate + "14", baseDate + "15", "SNO", -999.0);
        calls.verify(gridCacheService).getGrid(baseDate + "11", baseDate + "15", "SNO", -999.0);
        verifyNoMoreInteractions(gridCacheService);
    }

    private record ScalarCase(String variable, double value, String product,
                              String unit, Integer accumulationHours) { }

    private static double[][] filledGrid(double value) {
        double[][] grid = new double[DFS_NY][DFS_NX];
        for (double[] row : grid) Arrays.fill(row, value);
        return grid;
    }

    @SuppressWarnings("unchecked")
    private static List<Double> doubleList(Object value) {
        assertTrue(value instanceof List<?>);
        return (List<Double>) value;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> objectMap(Object value) {
        assertTrue(value instanceof Map<?, ?>);
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private static Map<Integer, Integer> integerMap(Object value) {
        assertTrue(value instanceof Map<?, ?>);
        return (Map<Integer, Integer>) value;
    }
}
