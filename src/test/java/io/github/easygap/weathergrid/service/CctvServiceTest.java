package io.github.easygap.weathergrid.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import io.github.easygap.weathergrid.dto.CctvResponseDto;
import io.github.easygap.weathergrid.exception.ExternalDataUnavailableException;
import io.github.easygap.weathergrid.exception.InvalidRequestException;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CctvServiceTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final Instant START = Instant.parse("2026-07-13T00:00:00Z");

    @Test
    void normalizesFiltersSortsAndCachesOneCanonicalTile() {
        ItsApiClient client = mock(ItsApiClient.class);
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(fixture(
                        item("나 지점", 37.11, 126.91, stream("b"), "R-1"),
                        item("가 지점", 37.10, 126.90, stream("a"), null),
                        item("영역 밖", 37.22, 126.92, stream("outside"), "R-3")));
        CctvService service = new CctvService(client,
                Clock.fixed(START, ZoneOffset.UTC));

        CctvResponseDto response = service.getCctv(37.05, 37.20, 126.80, 126.98);
        CctvResponseDto cached = service.getCctv(37.05, 37.20, 126.80, 126.98);

        assertEquals("2026-07-13T00:00:00Z", response.fetchedAt());
        assertFalse(response.stale());
        assertFalse(response.truncated());
        assertEquals("국가교통정보센터(ITS)", response.source());
        assertEquals(2, response.cctvs().size());
        assertEquals("가 지점", response.cctvs().get(0).name());
        assertEquals("가 지점@37.1000000,126.9000000", response.cctvs().get(0).id());
        assertEquals("R-1|나 지점@37.1100000,126.9100000", response.cctvs().get(1).id());
        assertEquals(response, cached);
        verify(client, times(1)).getCctv(37.0, 37.25, 126.75, 127.0);
    }

    @Test
    void returnsOldestTileFetchTimeAndDeterministicMergedOrder() {
        ItsApiClient client = mock(ItsApiClient.class);
        MutableClock clock = new MutableClock(START);
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenAnswer(invocation -> {
                    double minLon = invocation.getArgument(2);
                    double longitude = minLon >= 127.0 ? 127.05 : 126.95;
                    return fixture(item(minLon >= 127.0 ? "가" : "나", 37.1,
                            longitude, stream(Double.toString(minLon)), null));
                });
        CctvService service = new CctvService(client, clock);

        service.getCctv(37.05, 37.20, 126.90, 126.99);
        clock.advance(Duration.ofSeconds(10));
        CctvResponseDto response = service.getCctv(37.05, 37.20, 126.90, 127.10);

        assertEquals("2026-07-13T00:00:00Z", response.fetchedAt());
        assertEquals(2, response.cctvs().size());
        assertEquals("가", response.cctvs().get(0).name());
        assertEquals("나", response.cctvs().get(1).name());
    }

    @Test
    void servesFiveMinuteStaleDataAndBacksOffAfterRefreshFailure() {
        ItsApiClient client = mock(ItsApiClient.class);
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(fixture(item("지점", 37.1, 126.9, stream("live"), "R")))
                .thenThrow(new ExternalDataUnavailableException());
        MutableClock clock = new MutableClock(START);
        CctvService service = new CctvService(client, clock);

        assertFalse(service.getCctv(37.05, 37.20, 126.80, 126.98).stale());
        clock.advance(Duration.ofSeconds(61));

        assertTrue(service.getCctv(37.05, 37.20, 126.80, 126.98).stale());
        assertTrue(service.getCctv(37.05, 37.20, 126.80, 126.98).stale());
        verify(client, times(2)).getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble());

        clock.advance(Duration.ofMinutes(5));
        assertThrows(ExternalDataUnavailableException.class,
                () -> service.getCctv(37.05, 37.20, 126.80, 126.98));
        verify(client, times(3)).getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble());
    }

    @Test
    void dropsMalformedItemsAndMarksPartialResponseTruncated() {
        ItsApiClient client = mock(ItsApiClient.class);
        ObjectNode unsafe = item("HTTP", 37.1, 126.9,
                "http://cctvsec.ktict.co.kr/live.m3u8", "BAD");
        ObjectNode credential = item("Credential", 37.1, 126.91,
                "https://user@cctvsec.ktict.co.kr/live.m3u8", "BAD2");
        ObjectNode query = item("Query", 37.1, 126.93,
                "https://cctvsec.ktict.co.kr/live.m3u8?token=secret", "BAD3");
        ObjectNode wrongType = item("Type", 37.1, 126.94, stream("type"), "BAD4")
                .put("cctvtype", "1");
        ObjectNode wrongFormat = item("Format", 37.1, 126.95, stream("format"), "BAD5")
                .put("cctvformat", "MP4");
        ObjectNode lowerFormat = item("Lower", 37.1, 126.96, stream("lower"), "BAD6")
                .put("cctvformat", "hls");
        ObjectNode rootPath = item("Root", 37.1, 126.97,
                "https://cctvsec.ktict.co.kr/", "BAD7");
        ObjectNode controlName = item("제어\n문자", 37.1, 126.97,
                stream("control"), "BAD8");
        ObjectNode overlongName = item("가".repeat(201), 37.1, 126.97,
                stream("overlong"), "BAD9");
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(fixture(
                        item("정상", 37.1, 126.92, stream("safe"), "OK")
                                .put("cctvtype", "4"),
                        unsafe, credential, query, wrongType, wrongFormat, lowerFormat,
                        rootPath, controlName, overlongName));
        CctvService service = new CctvService(client,
                Clock.fixed(START, ZoneOffset.UTC));

        CctvResponseDto response = service.getCctv(37.05, 37.20, 126.80, 126.98);

        assertTrue(response.truncated());
        assertEquals(1, response.cctvs().size());
        assertEquals("정상", response.cctvs().get(0).name());
    }

    @Test
    void rejectsPositiveSnapshotsWhenEveryItemIsInvalid() {
        ItsApiClient client = mock(ItsApiClient.class);
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(fixture(item("잘못됨", 37.1, 126.9,
                        "https://example.com/live.m3u8", "BAD")));
        CctvService service = new CctvService(client,
                Clock.fixed(START, ZoneOffset.UTC));

        assertThrows(ExternalDataUnavailableException.class,
                () -> service.getCctv(37.05, 37.20, 126.80, 126.98));
    }

    @Test
    void requiresDeclaredCountButAcceptsADeclaredEmptyTile() {
        ItsApiClient missingCountClient = mock(ItsApiClient.class);
        when(missingCountClient.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(MAPPER.createObjectNode().set("response",
                        MAPPER.createObjectNode()
                                .set("header", MAPPER.createObjectNode().put("resultCode", "0"))));
        CctvService missingCount = new CctvService(missingCountClient,
                Clock.fixed(START, ZoneOffset.UTC));
        assertThrows(ExternalDataUnavailableException.class,
                () -> missingCount.getCctv(37.05, 37.20, 126.80, 126.98));

        ItsApiClient emptyClient = mock(ItsApiClient.class);
        when(emptyClient.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(emptyFixture());
        CctvResponseDto empty = new CctvService(emptyClient,
                Clock.fixed(START, ZoneOffset.UTC))
                .getCctv(37.05, 37.20, 126.80, 126.98);
        assertTrue(empty.cctvs().isEmpty());
        assertFalse(empty.truncated());
    }

    @Test
    void capsSortedItemsAtOneThousand() {
        ItsApiClient client = mock(ItsApiClient.class);
        ObjectNode root = baseFixture(5_001);
        ArrayNode items = (ArrayNode) root.path("response").path("body").path("items");
        for (int index = 0; index < 5_001; index++) {
            items.add(item(String.format("카메라%04d", index), 37.1, 126.9,
                    stream(Integer.toString(index)), null));
        }
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(root);
        CctvService service = new CctvService(client,
                Clock.fixed(START, ZoneOffset.UTC));

        CctvResponseDto response = service.getCctv(37.05, 37.20, 126.80, 126.98);

        assertTrue(response.truncated());
        assertEquals(1_000, response.cctvs().size());
        assertEquals("카메라0000", response.cctvs().get(0).name());
        assertEquals("카메라0999", response.cctvs().get(999).name());
    }

    @Test
    void rejectsRequestsThatExpandBeyondTwentyFourTilesBeforeUpstream() {
        ItsApiClient client = mock(ItsApiClient.class);
        CctvService service = new CctvService(client,
                Clock.fixed(START, ZoneOffset.UTC));

        assertThrows(InvalidRequestException.class,
                () -> service.getCctv(37.0, 38.5, 126.0, 127.25));
        verifyNoInteractions(client);
    }

    @Test
    void coalescesConcurrentColdMissesForTheSameTile() throws Exception {
        ItsApiClient client = mock(ItsApiClient.class);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenAnswer(invocation -> {
                    entered.countDown();
                    if (!release.await(2, TimeUnit.SECONDS)) {
                        throw new AssertionError("test release timed out");
                    }
                    return fixture(item("지점", 37.1, 126.9, stream("one"), "R"));
                });
        CctvService service = new CctvService(client,
                Clock.fixed(START, ZoneOffset.UTC));
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<CctvResponseDto> first = executor.submit(
                    () -> service.getCctv(37.05, 37.20, 126.80, 126.98));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            Future<CctvResponseDto> second = executor.submit(
                    () -> service.getCctv(37.05, 37.20, 126.80, 126.98));
            release.countDown();

            assertEquals(first.get(2, TimeUnit.SECONDS), second.get(2, TimeUnit.SECONDS));
            verify(client, times(1)).getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble());
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void startsTwentyFourColdTilesWithAtMostSixConcurrentReads() throws Exception {
        ItsApiClient client = mock(ItsApiClient.class);
        CountDownLatch firstWaveStarted = new CountDownLatch(6);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger maximum = new AtomicInteger();
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenAnswer(invocation -> {
                    int current = active.incrementAndGet();
                    maximum.accumulateAndGet(current, Math::max);
                    firstWaveStarted.countDown();
                    try {
                        if (!release.await(2, TimeUnit.SECONDS)) {
                            throw new AssertionError("test release timed out");
                        }
                        return emptyFixture();
                    } finally {
                        active.decrementAndGet();
                    }
                });
        CctvService service = new CctvService(client,
                Clock.fixed(START, ZoneOffset.UTC));
        ExecutorService caller = Executors.newSingleThreadExecutor();
        try {
            Future<CctvResponseDto> response = caller.submit(
                    () -> service.getCctv(37.01, 37.99, 126.01, 127.49));

            assertTrue(firstWaveStarted.await(2, TimeUnit.SECONDS));
            assertEquals(6, active.get());
            assertEquals(6, maximum.get());
            release.countDown();

            assertTrue(response.get(3, TimeUnit.SECONDS).cctvs().isEmpty());
            assertTrue(maximum.get() <= 6);
            verify(client, times(24)).getCctv(
                    anyDouble(), anyDouble(), anyDouble(), anyDouble());
        } finally {
            release.countDown();
            caller.shutdownNow();
            service.shutdownTileExecutor();
        }
    }

    @Test
    void cancelsADelayedSingleTileReadAtTheOverallDeadline() throws Exception {
        ItsApiClient client = mock(ItsApiClient.class);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch interrupted = new CountDownLatch(1);
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenAnswer(invocation -> {
                    started.countDown();
                    try {
                        release.await(5, TimeUnit.SECONDS);
                    } catch (InterruptedException e) {
                        interrupted.countDown();
                        Thread.currentThread().interrupt();
                        throw new ExternalDataUnavailableException();
                    }
                    return emptyFixture();
                });
        Clock clock = Clock.fixed(START, ZoneOffset.UTC);
        CctvService service = new CctvService(client, clock,
                EnvironmentalRateLimiter.unlimited(clock), Duration.ofMillis(100));
        long startedAt = System.nanoTime();
        try {
            assertThrows(ExternalDataUnavailableException.class,
                    () -> service.getCctv(37.05, 37.20, 126.80, 126.98));

            assertEquals(0, started.getCount());
            assertTrue(interrupted.await(1, TimeUnit.SECONDS));
            assertTrue(Duration.ofNanos(System.nanoTime() - startedAt).compareTo(
                    Duration.ofSeconds(2)) < 0);
        } finally {
            release.countDown();
            service.shutdownTileExecutor();
        }
    }

    @Test
    void capsConcurrentColdSingleTileRequestsAtSix() throws Exception {
        ItsApiClient client = mock(ItsApiClient.class);
        CountDownLatch firstSixStarted = new CountDownLatch(6);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger maximum = new AtomicInteger();
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenAnswer(invocation -> {
                    int current = active.incrementAndGet();
                    maximum.accumulateAndGet(current, Math::max);
                    firstSixStarted.countDown();
                    try {
                        if (!release.await(2, TimeUnit.SECONDS)) {
                            throw new AssertionError("test release timed out");
                        }
                        return emptyFixture();
                    } finally {
                        active.decrementAndGet();
                    }
                });
        CctvService service = new CctvService(client,
                Clock.fixed(START, ZoneOffset.UTC));
        ExecutorService callers = Executors.newFixedThreadPool(7);
        try {
            @SuppressWarnings("unchecked")
            Future<CctvResponseDto>[] responses = new Future[7];
            for (int index = 0; index < responses.length; index++) {
                double minLon = 126.01 + index * 0.25;
                responses[index] = callers.submit(() -> service.getCctv(
                        37.01, 37.20, minLon, minLon + 0.01));
            }

            assertTrue(firstSixStarted.await(2, TimeUnit.SECONDS));
            assertEquals(6, active.get());
            assertEquals(6, maximum.get());
            release.countDown();

            for (Future<CctvResponseDto> response : responses) {
                assertTrue(response.get(3, TimeUnit.SECONDS).cctvs().isEmpty());
            }
            assertTrue(maximum.get() <= 6);
            verify(client, times(7)).getCctv(
                    anyDouble(), anyDouble(), anyDouble(), anyDouble());
        } finally {
            release.countDown();
            callers.shutdownNow();
            service.shutdownTileExecutor();
        }
    }

    @Test
    void cacheKeySpaceRemainsBounded() {
        ItsApiClient client = mock(ItsApiClient.class);
        when(client.getCctv(anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(emptyFixture());
        CctvService service = new CctvService(client,
                Clock.fixed(START, ZoneOffset.UTC));

        for (int index = 0; index < 257; index++) {
            int latIndex = index / 48;
            int lonIndex = index % 48;
            double minLat = 32 + latIndex * 0.25 + 0.01;
            double minLon = 122 + lonIndex * 0.25 + 0.01;
            service.getCctv(minLat, minLat + 0.01, minLon, minLon + 0.01);
        }

        assertEquals(256, service.trackedTiles());
    }

    private static JsonNode fixture(ObjectNode... items) {
        ObjectNode root = baseFixture(items.length);
        ArrayNode array = (ArrayNode) root.path("response").path("body").path("items");
        for (ObjectNode item : items) array.add(item);
        return root;
    }

    private static ObjectNode baseFixture(int count) {
        ObjectNode root = MAPPER.createObjectNode();
        ObjectNode response = root.putObject("response");
        response.putObject("header").put("resultCode", "0").put("resultMsg", "SUCCESS");
        ObjectNode body = response.putObject("body");
        body.put("datacount", count);
        body.putArray("items");
        return root;
    }

    private static JsonNode emptyFixture() {
        ObjectNode root = MAPPER.createObjectNode();
        ObjectNode response = root.putObject("response");
        response.putObject("header").put("resultCode", "0");
        response.putObject("body").put("datacount", 0);
        return root;
    }

    private static ObjectNode item(String name, double latitude, double longitude,
                                   String url, String roadSectionId) {
        ObjectNode item = MAPPER.createObjectNode();
        item.put("cctvname", name);
        item.put("coordy", latitude);
        item.put("coordx", longitude);
        item.put("cctvurl", url);
        item.put("cctvformat", "HLS");
        item.put("cctvresolution", "1280x720");
        item.put("filecreatetime", "20260713090000");
        if (roadSectionId != null) item.put("roadsectionid", roadSectionId);
        return item;
    }

    private static String stream(String id) {
        return "https://cctvsec.ktict.co.kr/" + id + "/playlist.m3u8";
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
