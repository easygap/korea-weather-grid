package io.github.easygap.weathergrid.service;

import jakarta.servlet.http.HttpServletRequest;
import io.github.easygap.weathergrid.exception.RateLimitExceededException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 환경자료 공개 프록시와 상류 refresh의 메모리 상한이 고정된 fixed-window limiter.
 *
 * <p>Spring 인스턴스 단위 방어선이다. 다중 인스턴스의 전역 quota는 외부 저장소나
 * API gateway rate limit으로 별도 보장해야 한다.</p>
 */
@Component
public class EnvironmentalRateLimiter {

    private static final long MINUTE_SECONDS = 60;
    private static final long HOUR_SECONDS = 3_600;

    private final Clock clock;
    private final FixedWindowLimiter publicRequests;
    private final FixedWindowLimiter forecastRefreshes;
    private final FixedWindowLimiter airStationRefreshes;
    private final FixedWindowLimiter airMeasurementRefreshes;
    private final FixedWindowLimiter cctvRefreshes;
    private final List<CidrBlock> trustedProxies;

    @Autowired
    public EnvironmentalRateLimiter(
            @Value("${weather-grid.environmental-rate-limit.requests-per-minute:60}") int requestsPerMinute,
            @Value("${weather-grid.environmental-rate-limit.max-clients:10000}") int maxClients,
            @Value("${weather-grid.environmental-rate-limit.forecast-refreshes-per-minute:20}")
            int forecastRefreshesPerMinute,
            @Value("${weather-grid.environmental-rate-limit.air-refreshes-per-hour:2}")
            int airRefreshesPerHour,
            @Value("${weather-grid.environmental-rate-limit.cctv-refreshes-per-minute:30}")
            int cctvRefreshesPerMinute,
            @Value("${weather-grid.environmental-rate-limit.trusted-proxy-cidrs:}") String trustedProxyCidrs) {
        this(Clock.systemUTC(), requestsPerMinute, maxClients, forecastRefreshesPerMinute,
                airRefreshesPerHour, cctvRefreshesPerMinute, trustedProxyCidrs);
    }

    EnvironmentalRateLimiter(Clock clock, int requestsPerMinute, int maxClients,
                             int forecastRefreshesPerMinute, int airRefreshesPerHour,
                             String trustedProxyCidrs) {
        this(clock, requestsPerMinute, maxClients, forecastRefreshesPerMinute,
                airRefreshesPerHour, 30, trustedProxyCidrs);
    }

    EnvironmentalRateLimiter(Clock clock, int requestsPerMinute, int maxClients,
                             int forecastRefreshesPerMinute, int airRefreshesPerHour,
                             int cctvRefreshesPerMinute, String trustedProxyCidrs) {
        this.clock = clock;
        publicRequests = new FixedWindowLimiter(requestsPerMinute, MINUTE_SECONDS, maxClients);
        forecastRefreshes = new FixedWindowLimiter(
                forecastRefreshesPerMinute, MINUTE_SECONDS, 1);
        airStationRefreshes = new FixedWindowLimiter(airRefreshesPerHour, HOUR_SECONDS, 1);
        airMeasurementRefreshes = new FixedWindowLimiter(airRefreshesPerHour, HOUR_SECONDS, 1);
        cctvRefreshes = new FixedWindowLimiter(cctvRefreshesPerMinute, MINUTE_SECONDS, 1);
        trustedProxies = parseCidrs(trustedProxyCidrs);
    }

    static EnvironmentalRateLimiter unlimited(Clock clock) {
        return new EnvironmentalRateLimiter(clock, Integer.MAX_VALUE, 10_000,
                Integer.MAX_VALUE, Integer.MAX_VALUE, Integer.MAX_VALUE, "");
    }

    public void checkPublicRequest(HttpServletRequest request, String route) {
        acquire(publicRequests, route + ":" + clientId(request));
    }

    public void acquireForecastRefresh() {
        acquire(forecastRefreshes, "forecast");
    }

    public void acquireAirStationRefresh() {
        acquire(airStationRefreshes, "stations");
    }

    public void acquireAirMeasurementRefresh() {
        acquire(airMeasurementRefreshes, "measurements");
    }

    public void acquireCctvRefresh() {
        acquire(cctvRefreshes, "cctv");
    }

    int trackedPublicClients() {
        return publicRequests.size();
    }

    private void acquire(FixedWindowLimiter limiter, String key) {
        long now = clock.instant().getEpochSecond();
        long retryAfter = limiter.tryAcquire(key, now);
        if (retryAfter > 0) throw new RateLimitExceededException(retryAfter);
    }

    private String clientId(HttpServletRequest request) {
        InetAddress remote = literalAddress(request.getRemoteAddr());
        if (remote != null && trustedProxies.stream().anyMatch(block -> block.contains(remote))) {
            InetAddress forwarded = literalAddress(request.getHeader("CF-Connecting-IP"));
            if (forwarded != null) return forwarded.getHostAddress();
        }
        return remote != null ? remote.getHostAddress() : "unknown";
    }

    private static List<CidrBlock> parseCidrs(String source) {
        if (source == null || source.isBlank()) return List.of();
        List<CidrBlock> result = new ArrayList<>();
        for (String token : source.split("[,\\s]+")) {
            CidrBlock block = CidrBlock.parse(token);
            if (block != null) result.add(block);
        }
        return List.copyOf(result);
    }

    private static InetAddress literalAddress(String source) {
        if (source == null) return null;
        String value = source.trim();
        if (value.isEmpty() || value.length() > 45 || value.contains("%")) return null;
        boolean ipv6 = value.indexOf(':') >= 0;
        if (ipv6) {
            if (!value.matches("[0-9A-Fa-f:.]+")) return null;
        } else {
            String[] parts = value.split("\\.", -1);
            if (parts.length != 4) return null;
            for (String part : parts) {
                if (!part.matches("\\d{1,3}")) return null;
                int number = Integer.parseInt(part);
                if (number > 255) return null;
            }
        }
        try {
            return InetAddress.getByName(value);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static final class FixedWindowLimiter {
        private final int limit;
        private final long windowSeconds;
        private final int maxKeys;
        private final LinkedHashMap<String, Counter> counters =
                new LinkedHashMap<>(16, 0.75f, true);

        private FixedWindowLimiter(int limit, long windowSeconds, int maxKeys) {
            this.limit = Math.max(1, limit);
            this.windowSeconds = windowSeconds;
            this.maxKeys = Math.max(1, maxKeys);
        }

        /** 허용이면 0, 제한이면 다음 window까지 남은 초를 반환한다. */
        private synchronized long tryAcquire(String key, long nowEpochSecond) {
            long window = Math.floorDiv(nowEpochSecond, windowSeconds);
            Counter counter = counters.get(key);
            if (counter == null || counter.window() != window) {
                if (counter == null && counters.size() >= maxKeys) {
                    Iterator<Map.Entry<String, Counter>> iterator = counters.entrySet().iterator();
                    if (iterator.hasNext()) {
                        iterator.next();
                        iterator.remove();
                    }
                }
                counters.put(key, new Counter(window, 1));
                return 0;
            }
            if (counter.count() >= limit) {
                return Math.max(1, (window + 1) * windowSeconds - nowEpochSecond);
            }
            counters.put(key, new Counter(window, counter.count() + 1));
            return 0;
        }

        private synchronized int size() {
            return counters.size();
        }
    }

    private record Counter(long window, int count) {
    }

    private record CidrBlock(byte[] network, int prefixBits) {

        private static CidrBlock parse(String source) {
            if (source == null || source.isBlank()) return null;
            String[] parts = source.trim().split("/", -1);
            if (parts.length > 2) return null;
            InetAddress address = literalAddress(parts[0]);
            if (address == null) return null;
            int bits = address.getAddress().length * 8;
            int prefix = bits;
            if (parts.length == 2) {
                try {
                    prefix = Integer.parseInt(parts[1]);
                } catch (NumberFormatException ignored) {
                    return null;
                }
            }
            if (prefix < 0 || prefix > bits) return null;
            byte[] network = address.getAddress().clone();
            for (int bit = prefix; bit < bits; bit++) {
                network[bit / 8] &= (byte) ~(1 << (7 - bit % 8));
            }
            return new CidrBlock(network, prefix);
        }

        private boolean contains(InetAddress address) {
            byte[] candidate = address.getAddress();
            if (candidate.length != network.length) return false;
            int fullBytes = prefixBits / 8;
            for (int index = 0; index < fullBytes; index++) {
                if (candidate[index] != network[index]) return false;
            }
            int remaining = prefixBits % 8;
            if (remaining == 0) return true;
            int mask = (0xff << (8 - remaining)) & 0xff;
            return ((candidate[fullBytes] & 0xff) & mask)
                    == ((network[fullBytes] & 0xff) & mask);
        }
    }
}
