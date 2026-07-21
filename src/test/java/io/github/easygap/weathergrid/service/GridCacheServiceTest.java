package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.util.KimNcGridParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GridCacheServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void concurrentColdMissUsesOneUpstreamCallAndAtomicCacheFile() throws Exception {
        KmaApiService api = mock(KmaApiService.class);
        String sample = directionalGrid();
        when(api.fetchShortTermGridRaw("2026070414", "2026070418", "TMP"))
                .thenAnswer(invocation -> {
                    Thread.sleep(100);
                    return sample;
                });

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());

        int callers = 8;
        CountDownLatch start = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(callers);
        List<Future<double[][]>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < callers; i++) {
                futures.add(executor.submit(() -> {
                    start.await();
                    return service.getGrid("2026070414", "2026070418", "TMP", -999);
                }));
            }
            start.countDown();
            for (Future<double[][]> future : futures) assertNotNull(future.get());
        } finally {
            executor.shutdownNow();
        }

        verify(api, times(1)).fetchShortTermGridRaw("2026070414", "2026070418", "TMP");
        Path cacheFile = tempDir.resolve("grid/2026070414/TMP_2026070418.txt");
        assertTrue(Files.isRegularFile(cacheFile));
        assertEquals(sample, Files.readString(cacheFile, StandardCharsets.UTF_8));
        try (var files = Files.list(cacheFile.getParent())) {
            assertFalse(files.anyMatch(path -> path.getFileName().toString().endsWith(".tmp")));
        }
    }

    @Test
    void allZeroPrecipitationGridIsCachedWhenMissingValueIsMinus999() {
        KmaApiService api = mock(KmaApiService.class);
        String raw = "0 ".repeat(149 * 253).trim();
        when(api.fetchShortTermGridRaw("2026070414", "2026070415", "PCP"))
                .thenReturn(raw);

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());

        double[][] first = service.getGrid("2026070414", "2026070415", "PCP", -999.0);
        double[][] cached = service.getGrid("2026070414", "2026070415", "PCP", -999.0);

        assertNotNull(first);
        assertSame(first, cached);
        assertEquals(0.0, first[0][0]);
        assertEquals(0.0, first[252][148]);
        verify(api, times(1)).fetchShortTermGridRaw("2026070414", "2026070415", "PCP");
        assertTrue(Files.isRegularFile(tempDir.resolve("grid/2026070414/PCP_2026070415.txt")));
    }

    @Test
    void allSentinelScalarResponseIsNotCachedAndNextRequestRefetches() throws Exception {
        KmaApiService api = mock(KmaApiService.class);
        String invalid = constantGrid(9999);
        String valid = constantGrid(55);
        when(api.fetchShortTermGridRaw("2026070414", "2026070415", "REH"))
                .thenReturn(invalid, valid);

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());
        Path cacheFile = tempDir.resolve("grid/2026070414/REH_2026070415.txt");

        assertNull(service.getGrid("2026070414", "2026070415", "REH", -999.0));
        assertFalse(Files.exists(cacheFile));

        double[][] refreshed = service.getGrid("2026070414", "2026070415", "REH", -999.0);
        assertNotNull(refreshed);
        assertEquals(55.0, refreshed[0][0]);
        assertEquals(valid, Files.readString(cacheFile, StandardCharsets.UTF_8));
        verify(api, times(2)).fetchShortTermGridRaw("2026070414", "2026070415", "REH");
    }

    @Test
    void outOfRangeDiskCacheIsEvictedAndRefetched() throws Exception {
        KmaApiService api = mock(KmaApiService.class);
        String invalid = constantGrid(101);
        String valid = constantGrid(70);
        when(api.fetchShortTermGridRaw("2026070414", "2026070415", "REH"))
                .thenReturn(valid);

        Path cacheFile = tempDir.resolve("grid/2026070414/REH_2026070415.txt");
        Files.createDirectories(cacheFile.getParent());
        Files.writeString(cacheFile, invalid, StandardCharsets.UTF_8);

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());

        double[][] refreshed = service.getGrid("2026070414", "2026070415", "REH", -999.0);

        assertNotNull(refreshed);
        assertEquals(70.0, refreshed[0][0]);
        assertEquals(valid, Files.readString(cacheFile, StandardCharsets.UTF_8));
        verify(api).fetchShortTermGridRaw("2026070414", "2026070415", "REH");
    }

    @Test
    void categoricalCodesRejectUnknownValuesAndCacheKnownValues() {
        KmaApiService api = mock(KmaApiService.class);
        when(api.fetchShortTermGridRaw("2026070414", "2026070415", "PTY"))
                .thenReturn(constantGrid(5), constantGrid(4));
        when(api.fetchShortTermGridRaw("2026070414", "2026070415", "SKY"))
                .thenReturn(constantGrid(2), constantGrid(3));

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());

        for (String variable : new String[]{"PTY", "SKY"}) {
            Path cacheFile = tempDir.resolve("grid/2026070414/" + variable + "_2026070415.txt");
            assertNull(service.getGrid("2026070414", "2026070415", variable, -999.0));
            assertFalse(Files.exists(cacheFile));

            double[][] valid = service.getGrid("2026070414", "2026070415", variable, -999.0);
            assertNotNull(valid);
            assertEquals("PTY".equals(variable) ? 4.0 : 3.0, valid[0][0]);
            assertTrue(Files.isRegularFile(cacheFile));
            verify(api, times(2)).fetchShortTermGridRaw("2026070414", "2026070415", variable);
        }
    }

    @Test
    void windVariablesCacheCalmAndSignedValidValues() {
        KmaApiService api = mock(KmaApiService.class);
        String[] variables = {"WSD", "UUU", "VVV"};
        double[] values = {0, -12, 12};
        for (int i = 0; i < variables.length; i++) {
            when(api.fetchShortTermGridRaw("2026070414", "2026070415", variables[i]))
                    .thenReturn(constantGrid(values[i]));
        }

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());

        for (int i = 0; i < variables.length; i++) {
            double[][] first = service.getGrid("2026070414", "2026070415", variables[i], -999.0);
            double[][] cached = service.getGrid("2026070414", "2026070415", variables[i], -999.0);
            assertNotNull(first);
            assertSame(first, cached);
            assertEquals(values[i], first[0][0]);
            verify(api).fetchShortTermGridRaw("2026070414", "2026070415", variables[i]);
        }
    }

    @Test
    void allSentinelWindResponseIsNotCachedAndNextRequestRefetches() {
        KmaApiService api = mock(KmaApiService.class);
        when(api.fetchShortTermGridRaw("2026070414", "2026070415", "WSD"))
                .thenReturn(constantGrid(9999), constantGrid(0));

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());
        Path cacheFile = tempDir.resolve("grid/2026070414/WSD_2026070415.txt");

        assertNull(service.getGrid("2026070414", "2026070415", "WSD", -999.0));
        assertFalse(Files.exists(cacheFile));
        assertNotNull(service.getGrid("2026070414", "2026070415", "WSD", -999.0));
        assertTrue(Files.isRegularFile(cacheFile));
        verify(api, times(2)).fetchShortTermGridRaw("2026070414", "2026070415", "WSD");
    }

    @Test
    void allSentinelWindDiskCacheIsEvictedAndRefetched() throws Exception {
        KmaApiService api = mock(KmaApiService.class);
        String valid = constantGrid(-12);
        when(api.fetchShortTermGridRaw("2026070414", "2026070415", "UUU"))
                .thenReturn(valid);
        Path cacheFile = tempDir.resolve("grid/2026070414/UUU_2026070415.txt");
        Files.createDirectories(cacheFile.getParent());
        Files.writeString(cacheFile, constantGrid(9999), StandardCharsets.UTF_8);

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());

        double[][] refreshed = service.getGrid("2026070414", "2026070415", "UUU", -999.0);
        assertNotNull(refreshed);
        assertEquals(-12.0, refreshed[0][0]);
        assertEquals(valid, Files.readString(cacheFile, StandardCharsets.UTF_8));
        verify(api).fetchShortTermGridRaw("2026070414", "2026070415", "UUU");
    }

    @Test
    void windVariablesRejectPhysicalOutliers() {
        KmaApiService api = mock(KmaApiService.class);
        String[] variables = {"WSD", "UUU", "VVV"};
        double[] invalid = {213, -151, 151};
        for (int i = 0; i < variables.length; i++) {
            when(api.fetchShortTermGridRaw("2026070414", "2026070415", variables[i]))
                    .thenReturn(constantGrid(invalid[i]));
        }

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());

        for (String variable : variables) {
            assertNull(service.getGrid("2026070414", "2026070415", variable, -999.0));
            assertFalse(Files.exists(tempDir.resolve(
                    "grid/2026070414/" + variable + "_2026070415.txt")));
        }
    }

    @Test
    void valueOnlyOutsideForecastDisplayAreaDoesNotValidateRawResponse() {
        KmaApiService api = mock(KmaApiService.class);
        when(api.fetchShortTermGridRaw("2026070414", "2026070415", "REH"))
                .thenReturn(gridWithSingleValue(1, 1, 50, 9999), constantGrid(60));

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());
        Path cacheFile = tempDir.resolve("grid/2026070414/REH_2026070415.txt");

        assertNull(service.getGrid("2026070414", "2026070415", "REH", -999.0));
        assertFalse(Files.exists(cacheFile));
        assertNotNull(service.getGrid("2026070414", "2026070415", "REH", -999.0));
        verify(api, times(2)).fetchShortTermGridRaw("2026070414", "2026070415", "REH");
    }

    @Test
    void diskCacheValidOnlyOutsideForecastDisplayAreaIsEvicted() throws Exception {
        KmaApiService api = mock(KmaApiService.class);
        String valid = constantGrid(65);
        when(api.fetchShortTermGridRaw("2026070414", "2026070415", "REH"))
                .thenReturn(valid);
        Path cacheFile = tempDir.resolve("grid/2026070414/REH_2026070415.txt");
        Files.createDirectories(cacheFile.getParent());
        Files.writeString(cacheFile, gridWithSingleValue(1, 1, 50, 9999), StandardCharsets.UTF_8);

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());

        assertNotNull(service.getGrid("2026070414", "2026070415", "REH", -999.0));
        assertEquals(valid, Files.readString(cacheFile, StandardCharsets.UTF_8));
        verify(api).fetchShortTermGridRaw("2026070414", "2026070415", "REH");
    }

    @Test
    void kimAllZeroGridKeepsExistingCacheContract() {
        KmaApiService api = mock(KmaApiService.class);
        String raw = kimGrid(0);
        when(api.fetchKimNcGridRaw("2026070412", 6, "dswrsfc")).thenReturn(raw);

        GridCacheService service = new GridCacheService(api);
        ReflectionTestUtils.setField(service, "cachePath", tempDir.toString());

        double[][] first = service.getKimGrid("2026070412", 6, "dswrsfc");
        double[][] cached = service.getKimGrid("2026070412", 6, "dswrsfc");

        assertNotNull(first);
        assertSame(first, cached);
        assertEquals(0.0, first[0][0]);
        verify(api).fetchKimNcGridRaw("2026070412", 6, "dswrsfc");
        assertTrue(Files.isRegularFile(
                tempDir.resolve("grid/kim/2026070412/dswrsfc_006.txt")));
    }

    private static String constantGrid(double value) {
        String token = value == Math.rint(value) ? Long.toString((long) value) : Double.toString(value);
        return (token + " ").repeat(149 * 253).trim();
    }

    private static String directionalGrid() {
        StringBuilder raw = new StringBuilder(149 * 253 * 6);
        for (int row = 0; row < 253; row++) {
            for (int col = 0; col < 149; col++) {
                double value = 10.0 + (row % 20) * 0.5 + (col % 10) * 0.05;
                raw.append(value);
                raw.append(col == 148 ? '\n' : (col % 2 == 0 ? ',' : ' '));
            }
        }
        return raw.toString();
    }

    private static String gridWithSingleValue(int nx, int ny, double value, double other) {
        int selected = (ny - 1) * 149 + (nx - 1);
        StringBuilder raw = new StringBuilder(149 * 253 * 5);
        for (int i = 0; i < 149 * 253; i++) {
            raw.append(i == selected ? value : other).append(' ');
        }
        return raw.toString().trim();
    }

    private static String kimGrid(double value) {
        String token = value == Math.rint(value) ? Long.toString((long) value) : Double.toString(value);
        return "# i = " + KimNcGridParser.NX + ", j = " + KimNcGridParser.NY
                + ", map = S (x_min = " + KimNcGridParser.X_MIN
                + ", y_min = " + KimNcGridParser.Y_MIN
                + ", x_max = " + KimNcGridParser.X_MAX
                + ", y_max = " + KimNcGridParser.Y_MAX + ")\n"
                + (token + " ").repeat(KimNcGridParser.NX * KimNcGridParser.NY).trim();
    }
}
