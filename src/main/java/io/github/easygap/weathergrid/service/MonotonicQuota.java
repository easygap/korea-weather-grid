package io.github.easygap.weathergrid.service;

import java.time.Duration;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/** Bounded per-key quota whose windows depend only on elapsed monotonic time. */
final class MonotonicQuota {

    private static final long NANOS_PER_SECOND = Duration.ofSeconds(1).toNanos();

    private final int permitsPerWindow;
    private final long windowNanos;
    private final int maximumKeys;
    private final LinkedHashMap<String, WindowState> states =
            new LinkedHashMap<>(16, 0.75f, true);

    MonotonicQuota(int permitsPerWindow, Duration window, int maximumKeys) {
        if (permitsPerWindow < 1) throw new IllegalArgumentException("permitsPerWindow must be positive");
        if (window == null || window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("window must be positive");
        }
        if (maximumKeys < 1) throw new IllegalArgumentException("maximumKeys must be positive");
        this.permitsPerWindow = permitsPerWindow;
        this.windowNanos = window.toNanos();
        this.maximumKeys = maximumKeys;
    }

    /** Returns zero when admitted, otherwise the ceiling retry delay in seconds. */
    synchronized long claim(String key, long nowNanos) {
        if (key == null || key.isBlank()) throw new IllegalArgumentException("quota key is blank");
        WindowState previous = states.get(key);
        if (previous == null || elapsed(nowNanos, previous.openedAtNanos()) >= windowNanos) {
            if (previous == null) evictOldestWhenFull();
            states.put(key, new WindowState(nowNanos, 1));
            return 0;
        }
        if (previous.permitsUsed() < permitsPerWindow) {
            states.put(key, new WindowState(previous.openedAtNanos(), previous.permitsUsed() + 1));
            return 0;
        }
        long remaining = windowNanos - elapsed(nowNanos, previous.openedAtNanos());
        return Math.max(1, (remaining + NANOS_PER_SECOND - 1) / NANOS_PER_SECOND);
    }

    synchronized int trackedKeys() {
        return states.size();
    }

    private static long elapsed(long now, long then) {
        long difference = now - then;
        return difference < 0 ? Long.MAX_VALUE : difference;
    }

    private void evictOldestWhenFull() {
        if (states.size() < maximumKeys) return;
        Iterator<Map.Entry<String, WindowState>> iterator = states.entrySet().iterator();
        if (iterator.hasNext()) {
            iterator.next();
            iterator.remove();
        }
    }

    private record WindowState(long openedAtNanos, int permitsUsed) { }
}
