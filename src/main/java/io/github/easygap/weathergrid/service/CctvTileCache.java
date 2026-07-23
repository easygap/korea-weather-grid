package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.exception.RequestRejectedException;
import io.github.easygap.weathergrid.exception.RequestThrottledException;
import io.github.easygap.weathergrid.integration.TrafficCameraFeed;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;

/** Fixed-cell cache that bounds ITS calls, concurrency, stale use and retry pressure. */
@Component
public final class CctvTileCache {

    static final double CELL_DEGREES = 0.25;
    static final int MAX_CELLS_PER_QUERY = 24;
    private static final int CACHE_CAPACITY = 256;
    private static final int WORKERS = 6;
    private static final Duration FRESH_FOR = Duration.ofMinutes(1);
    private static final Duration STALE_FOR = Duration.ofMinutes(5);
    private static final Duration RETRY_PAUSE = Duration.ofMinutes(1);
    private static final Duration BATCH_TIMEOUT = Duration.ofSeconds(10);
    private static final AtomicInteger THREAD_NUMBER = new AtomicInteger();

    private final TrafficCameraFeed feed;
    private final WeatherRequestBudget budget;
    private final Clock clock;
    private final Duration batchTimeout;
    private final ThreadPoolExecutor workers;
    private final Map<Cell, CellEntry> entries = Collections.synchronizedMap(
            new LinkedHashMap<>(CACHE_CAPACITY + 1, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<Cell, CellEntry> eldest) {
                    return size() > CACHE_CAPACITY;
                }
            });

    @Autowired
    public CctvTileCache(TrafficCameraFeed feed, WeatherRequestBudget budget) {
        this(feed, budget, Clock.systemUTC(), BATCH_TIMEOUT);
    }

    CctvTileCache(TrafficCameraFeed feed, WeatherRequestBudget budget,
                  Clock clock, Duration batchTimeout) {
        if (feed == null || budget == null || clock == null || batchTimeout == null
                || batchTimeout.isZero() || batchTimeout.isNegative()) {
            throw new IllegalArgumentException("Invalid CCTV cache dependency");
        }
        this.feed = feed;
        this.budget = budget;
        this.clock = clock;
        this.batchTimeout = batchTimeout;
        workers = new ThreadPoolExecutor(WORKERS, WORKERS, 0, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(MAX_CELLS_PER_QUERY * 4), runnable -> {
                    Thread thread = new Thread(runnable,
                            "weather-grid-camera-" + THREAD_NUMBER.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.AbortPolicy());
    }

    public Result load(Viewport viewport) {
        List<Cell> cells = cells(viewport);
        List<Callable<CellRead>> jobs = cells.stream()
                .<Callable<CellRead>>map(cell -> () -> read(cell))
                .toList();
        List<Future<CellRead>> futures;
        try {
            futures = workers.invokeAll(jobs, batchTimeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new UpstreamUnavailableException();
        } catch (RejectedExecutionException overloaded) {
            throw new UpstreamUnavailableException();
        }

        List<TrafficCameraFeed.Camera> cameras = new ArrayList<>();
        boolean stale = false;
        boolean truncated = false;
        Instant oldest = null;
        for (Future<CellRead> future : futures) {
            if (future.isCancelled()) throw new UpstreamUnavailableException();
            try {
                CellRead read = future.get();
                cameras.addAll(read.snapshot.batch.cameras());
                stale |= read.stale;
                truncated |= read.snapshot.batch.truncated();
                if (oldest == null || read.snapshot.fetchedAt.isBefore(oldest)) {
                    oldest = read.snapshot.fetchedAt;
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new UpstreamUnavailableException();
            } catch (ExecutionException failed) {
                Throwable cause = failed.getCause();
                if (cause instanceof RequestThrottledException rateLimit) throw rateLimit;
                throw new UpstreamUnavailableException();
            }
        }
        if (oldest == null) throw new UpstreamUnavailableException();
        return new Result(List.copyOf(cameras), oldest, stale, truncated);
    }

    private CellRead read(Cell cell) throws InterruptedException {
        CellEntry entry = entry(cell);
        Instant now = clock.instant();
        Snapshot cached = entry.snapshot;
        if (usable(cached, FRESH_FOR, now)) return new CellRead(cached, false);

        entry.gate.lockInterruptibly();
        try {
            now = clock.instant();
            cached = entry.snapshot;
            if (usable(cached, FRESH_FOR, now)) return new CellRead(cached, false);
            if (now.isBefore(entry.retryAt)) {
                if (usable(cached, STALE_FOR, now)) return new CellRead(cached, true);
                throw new UpstreamUnavailableException();
            }

            try {
                budget.claimRefresh(WeatherRequestBudget.RefreshSource.TRAFFIC_CAMERAS);
                TrafficCameraFeed.Batch batch = feed.retrieve(
                        cell.south(), cell.north(), cell.west(), cell.east());
                Snapshot loaded = new Snapshot(batch, clock.instant());
                entry.snapshot = loaded;
                entry.retryAt = Instant.EPOCH;
                touch(cell, entry);
                return new CellRead(loaded, false);
            } catch (RequestThrottledException limited) {
                if (usable(cached, STALE_FOR, clock.instant())) return new CellRead(cached, true);
                throw limited;
            } catch (UpstreamUnavailableException unavailable) {
                entry.retryAt = clock.instant().plus(RETRY_PAUSE);
                touch(cell, entry);
                if (usable(cached, STALE_FOR, clock.instant())) return new CellRead(cached, true);
                throw unavailable;
            }
        } finally {
            entry.gate.unlock();
        }
    }

    private CellEntry entry(Cell cell) {
        synchronized (entries) {
            return entries.computeIfAbsent(cell, ignored -> new CellEntry());
        }
    }

    private void touch(Cell cell, CellEntry entry) {
        synchronized (entries) {
            entries.put(cell, entry);
        }
    }

    private static boolean usable(Snapshot snapshot, Duration age, Instant now) {
        return snapshot != null && now.isBefore(snapshot.fetchedAt.plus(age));
    }

    private static List<Cell> cells(Viewport viewport) {
        int south = (int) Math.floor(viewport.south / CELL_DEGREES);
        int northExclusive = (int) Math.ceil(viewport.north / CELL_DEGREES);
        int west = (int) Math.floor(viewport.west / CELL_DEGREES);
        int eastExclusive = (int) Math.ceil(viewport.east / CELL_DEGREES);
        long count = (long) (northExclusive - south) * (eastExclusive - west);
        if (count < 1 || count > MAX_CELLS_PER_QUERY) {
            throw new RequestRejectedException("CCTV 조회 영역이 너무 큼");
        }
        List<Cell> result = new ArrayList<>((int) count);
        for (int latitude = south; latitude < northExclusive; latitude++) {
            for (int longitude = west; longitude < eastExclusive; longitude++) {
                result.add(new Cell(latitude, longitude));
            }
        }
        return List.copyOf(result);
    }

    int trackedCells() {
        synchronized (entries) {
            return entries.size();
        }
    }

    @PreDestroy
    void close() {
        workers.shutdownNow();
    }

    public record Viewport(double south, double north, double west, double east) {
        public Viewport {
            if (!Double.isFinite(south) || !Double.isFinite(north)
                    || !Double.isFinite(west) || !Double.isFinite(east)
                    || south < 32 || north > 44 || west < 122 || east > 134
                    || south >= north || west >= east) {
                throw new RequestRejectedException("잘못된 CCTV 조회 영역");
            }
        }
    }

    public record Result(List<TrafficCameraFeed.Camera> cameras, Instant fetchedAt,
                         boolean stale, boolean truncated) {
        public Result {
            cameras = List.copyOf(cameras);
        }
    }

    private record Cell(int latitudeIndex, int longitudeIndex) {
        private double south() { return latitudeIndex * CELL_DEGREES; }
        private double north() { return (latitudeIndex + 1) * CELL_DEGREES; }
        private double west() { return longitudeIndex * CELL_DEGREES; }
        private double east() { return (longitudeIndex + 1) * CELL_DEGREES; }
    }

    private static final class CellEntry {
        private final ReentrantLock gate = new ReentrantLock();
        private volatile Snapshot snapshot;
        private volatile Instant retryAt = Instant.EPOCH;
    }

    private record Snapshot(TrafficCameraFeed.Batch batch, Instant fetchedAt) {
    }

    private record CellRead(Snapshot snapshot, boolean stale) {
    }
}
