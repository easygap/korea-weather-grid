package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.integration.KmaTextGateway;
import io.github.easygap.weathergrid.util.KimGridGeometry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GridDataRepositoryTest {

    @TempDir
    Path temporaryDirectory;

    @Test
    void concurrentMissHasOneLeaderAndASecondRepositoryUsesTheRawArchive() throws Exception {
        KmaTextGateway gateway = mock(KmaTextGateway.class);
        GridRawArchive archive = archive();
        String raw = constantDfs(12);
        when(gateway.downloadDfsGrid("2026072114", "2026072115", "TMP"))
                .thenAnswer(call -> {
                    Thread.sleep(75);
                    return raw;
                });
        GridDataRepository repository = new GridDataRepository(gateway, archive);
        CountDownLatch start = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(8);
        List<Future<double[][]>> results = new ArrayList<>();
        try {
            for (int index = 0; index < 8; index++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return repository.readDfs("2026072114", "2026072115", "TMP", -999);
                }));
            }
            start.countDown();
            for (Future<double[][]> result : results) assertNotNull(result.get());
        } finally {
            pool.shutdownNow();
        }

        GridDataRepository restarted = new GridDataRepository(gateway, archive);
        assertEquals(12, restarted.readDfs("2026072114", "2026072115", "TMP", -999)[0][0]);
        verify(gateway, times(1)).downloadDfsGrid("2026072114", "2026072115", "TMP");
        assertTrue(Files.isRegularFile(archive.pathFor(
                GridArchiveKey.dfs("2026072114", "2026072115", "TMP"))));
    }

    @Test
    void invalidDownloadIsNotPersistedAndTheNextLookupRetries() {
        KmaTextGateway gateway = mock(KmaTextGateway.class);
        GridRawArchive archive = archive();
        when(gateway.downloadDfsGrid("2026072114", "2026072115", "REH"))
                .thenReturn(constantDfs(9999), constantDfs(55));
        GridDataRepository repository = new GridDataRepository(gateway, archive);
        GridArchiveKey key = GridArchiveKey.dfs("2026072114", "2026072115", "REH");

        assertNull(repository.readDfs("2026072114", "2026072115", "REH", -999));
        assertTrue(archive.read(key).isEmpty());
        assertEquals(55, repository.readDfs("2026072114", "2026072115", "REH", -999)[0][0]);

        verify(gateway, times(2)).downloadDfsGrid("2026072114", "2026072115", "REH");
        assertTrue(archive.read(key).isPresent());
    }

    @Test
    void invalidArchivedFieldIsDiscardedBeforeAValidReplacementIsStored() {
        KmaTextGateway gateway = mock(KmaTextGateway.class);
        GridRawArchive archive = archive();
        GridArchiveKey key = GridArchiveKey.dfs("2026072114", "2026072115", "REH");
        assertTrue(archive.store(key, constantDfs(101)));
        when(gateway.downloadDfsGrid("2026072114", "2026072115", "REH"))
                .thenReturn(constantDfs(70));

        double[][] field = new GridDataRepository(gateway, archive)
                .readDfs("2026072114", "2026072115", "REH", -999);

        assertNotNull(field);
        assertEquals(70, field[0][0]);
        assertEquals(constantDfs(70), archive.read(key).orElseThrow());
    }

    @Test
    void kimSolarAcceptsARealAllZeroFieldAndReusesItFromMemory() {
        KmaTextGateway gateway = mock(KmaTextGateway.class);
        when(gateway.downloadSurfaceSolarGrid("2026072112", 6, "dswrsfc"))
                .thenReturn(kimGrid(0));
        GridDataRepository repository = new GridDataRepository(gateway, archive());

        double[][] first = repository.readKimSolar("2026072112", 6);
        double[][] second = repository.readKimSolar("2026072112", 6);

        assertNotNull(first);
        assertTrue(first == second);
        assertEquals(0, first[0][0]);
        verify(gateway, times(1)).downloadSurfaceSolarGrid("2026072112", 6, "dswrsfc");
    }

    @Test
    void lookupValidationRejectsUnsafeOrUnsupportedKeysBeforeCallingTheGateway() {
        KmaTextGateway gateway = mock(KmaTextGateway.class);
        GridDataRepository repository = new GridDataRepository(gateway, archive());

        assertThrows(IllegalArgumentException.class,
                () -> repository.readDfs("../../secret", "2026072115", "TMP", -999));
        assertThrows(IllegalArgumentException.class,
                () -> repository.readDfs("2026072114", "2026072113", "TMP", -999));
        assertThrows(IllegalArgumentException.class,
                () -> repository.readDfs("2026072114", "2026072115", "SECRET", -999));
        assertThrows(IllegalArgumentException.class,
                () -> repository.readKimSolar("2026072114", 6));
        assertThrows(IllegalArgumentException.class,
                () -> repository.readKimSolar("2026072112", 137));

        verify(gateway, never()).downloadDfsGrid(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void parsedMemoryHasAnExplicitEntryLimit() {
        KmaTextGateway gateway = mock(KmaTextGateway.class);
        when(gateway.downloadDfsGrid("2026072114", "2026072115", "TMP"))
                .thenReturn(constantDfs(10));
        when(gateway.downloadDfsGrid("2026072114", "2026072115", "REH"))
                .thenReturn(constantDfs(50));
        when(gateway.downloadDfsGrid("2026072114", "2026072115", "PCP"))
                .thenReturn(constantDfs(0));
        GridDataRepository repository = new GridDataRepository(gateway, archive(), 2);

        repository.readDfs("2026072114", "2026072115", "TMP", -999);
        repository.readDfs("2026072114", "2026072115", "REH", -999);
        repository.readDfs("2026072114", "2026072115", "PCP", -999);

        assertEquals(2, repository.memoryEntries());
    }

    private GridRawArchive archive() {
        return new GridRawArchive(temporaryDirectory.resolve("archive"), 14, Clock.systemUTC());
    }

    private static String constantDfs(double value) {
        String token = value == Math.rint(value) ? Long.toString((long) value) : Double.toString(value);
        return (token + " ").repeat(149 * 253).trim();
    }

    private static String kimGrid(double value) {
        String token = value == Math.rint(value) ? Long.toString((long) value) : Double.toString(value);
        return "# i = " + KimGridGeometry.COLUMNS + ", j = " + KimGridGeometry.ROWS
                + ", map = S (x_min = " + KimGridGeometry.WEST_INDEX
                + ", y_min = " + KimGridGeometry.SOUTH_INDEX
                + ", x_max = " + KimGridGeometry.EAST_INDEX
                + ", y_max = " + KimGridGeometry.NORTH_INDEX + ")\n"
                + (token + " ").repeat(KimGridGeometry.COLUMNS * KimGridGeometry.ROWS).trim();
    }
}
