package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.MinMaxAvgDto;
import io.github.easygap.weathergrid.exception.WeatherDataUnavailableException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

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
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MapServicePrecipitationGridTest {

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
    }

    @Test
    void allZeroPrecipitationIsValidAndPublishesAccumulationMetadata() {
        when(kmaApiService.snapToValidBaseDateTime(baseDate, "0200"))
                .thenReturn(new String[]{baseDate, "0200"});
        double[][] precipitation = filledGrid(0.0);
        when(gridCacheService.getGrid(baseDate + "02", baseDate + "03", "PCP", -999.0))
                .thenReturn(precipitation);

        Map<String, Object> result = mapService.getGridData(baseDate, "0200", "pcp", 0);
        List<Double> data = doubleList(result.get("data"));
        MinMaxAvgDto stats = (MinMaxAvgDto) result.get("stats");
        LocalDateTime requestedRun = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE)
                .atTime(2, 0);

        assertEquals(FIELD_NX * FIELD_NY, data.size());
        assertTrue(data.stream().allMatch(value -> value == 0.0), "0mm는 무강수 실값이다");
        assertEquals(0.0, stats.getMin());
        assertEquals(0.0, stats.getAvg());
        assertEquals(0.0, stats.getMax());
        assertEquals(kstTime(requestedRun), result.get("referenceTime"));
        assertEquals(kstTime(requestedRun.plusHours(1)), result.get("validTime"));
        assertEquals(modelRunTime(requestedRun), result.get("modelRunTime"));
        assertEquals(1, result.get("modelForecastHour"));
        assertEquals(false, result.get("fallbackUsed"));
        assertEquals("KMA DFS PCP", result.get("product"));
        assertEquals("mm", result.get("unit"));
        assertEquals(1, result.get("accumulationHours"));
        assertTrue(result.containsKey("windField"));
        assertNull(result.get("windField"));
        verify(gridCacheService).getGrid(baseDate + "02", baseDate + "03", "PCP", -999.0);
    }

    @Test
    void precipitationKeepsValidTimeAndFallsBackToPreviousThreeHourRun() {
        when(kmaApiService.snapToValidBaseDateTime(baseDate, "1400"))
                .thenReturn(new String[]{baseDate, "1400"});
        double[][] precipitation = filledGrid(4.2);
        // 응답 첫 셀은 DFS ny=162,nx=5, 두 번째 셀은 nx=6이다.
        precipitation[161][4] = -999.0;
        precipitation[161][5] = 0.0;
        when(gridCacheService.getGrid(baseDate + "14", baseDate + "15", "PCP", -999.0))
                .thenReturn(null);
        when(gridCacheService.getGrid(baseDate + "11", baseDate + "15", "PCP", -999.0))
                .thenReturn(precipitation);

        Map<String, Object> result = mapService.getGridData(baseDate, "1400", "pcp", 1);
        List<Double> data = doubleList(result.get("data"));
        MinMaxAvgDto stats = (MinMaxAvgDto) result.get("stats");
        LocalDateTime requestedRun = LocalDate.parse(baseDate, DateTimeFormatter.BASIC_ISO_DATE)
                .atTime(14, 0);
        LocalDateTime fallbackRun = requestedRun.minusHours(3);

        assertEquals(-999.0, data.get(0));
        assertEquals(0.0, data.get(1));
        assertEquals(0.0, stats.getMin());
        assertEquals(4.2, stats.getAvg());
        assertEquals(4.2, stats.getMax());
        assertEquals(kstTime(requestedRun.plusHours(1)), result.get("validTime"));
        assertEquals(modelRunTime(fallbackRun), result.get("modelRunTime"));
        assertEquals(4, result.get("modelForecastHour"));
        assertEquals(true, result.get("fallbackUsed"));
        assertNull(result.get("windField"));

        InOrder calls = inOrder(gridCacheService);
        calls.verify(gridCacheService).getGrid(baseDate + "14", baseDate + "15", "PCP", -999.0);
        calls.verify(gridCacheService).getGrid(baseDate + "11", baseDate + "15", "PCP", -999.0);
        verifyNoMoreInteractions(gridCacheService);
    }

    @Test
    void precipitationStopsAfterLatestAndPreviousRunBothFail() {
        when(kmaApiService.snapToValidBaseDateTime(baseDate, "1400"))
                .thenReturn(new String[]{baseDate, "1400"});

        WeatherDataUnavailableException error = assertThrows(WeatherDataUnavailableException.class,
                () -> mapService.getGridData(baseDate, "1400", "pcp", 1));

        assertEquals("precipitation grid unavailable", error.getMessage());
        InOrder calls = inOrder(gridCacheService);
        calls.verify(gridCacheService).getGrid(baseDate + "14", baseDate + "15", "PCP", -999.0);
        calls.verify(gridCacheService).getGrid(baseDate + "11", baseDate + "15", "PCP", -999.0);
        verifyNoMoreInteractions(gridCacheService);
    }

    private static double[][] filledGrid(double value) {
        double[][] grid = new double[DFS_NY][DFS_NX];
        for (double[] row : grid) Arrays.fill(row, value);
        return grid;
    }

    private static String kstTime(LocalDateTime time) {
        return time.format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")) + "+09:00";
    }

    private static String modelRunTime(LocalDateTime runKst) {
        return runKst.atZone(ZoneId.of("Asia/Seoul"))
                .withZoneSameInstant(ZoneOffset.UTC)
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'"));
    }

    @SuppressWarnings("unchecked")
    private static List<Double> doubleList(Object value) {
        assertTrue(value instanceof List<?>);
        return (List<Double>) value;
    }
}
