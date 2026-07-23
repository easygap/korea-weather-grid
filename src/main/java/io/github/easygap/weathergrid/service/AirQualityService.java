package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.AirQualityReport;
import io.github.easygap.weathergrid.dto.AirQualityReading;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.integration.AirQualityFeed;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/** Joins AirKorea measurements to station coordinates and applies the requested map viewport. */
@Service
public final class AirQualityService {

    private static final String SOURCE = "AirKorea";
    private static final Map<String, List<String>> REGIONS = Map.ofEntries(
            Map.entry("서울", List.of("서울특별시", "서울")),
            Map.entry("부산", List.of("부산광역시", "부산")),
            Map.entry("대구", List.of("대구광역시", "대구")),
            Map.entry("인천", List.of("인천광역시", "인천")),
            Map.entry("대전", List.of("대전광역시", "대전")),
            Map.entry("광주", List.of("광주광역시", "광주")),
            Map.entry("울산", List.of("울산광역시", "울산")),
            Map.entry("경기", List.of("경기도", "경기")),
            Map.entry("강원", List.of("강원특별자치도", "강원도", "강원")),
            Map.entry("충북", List.of("충청북도", "충북")),
            Map.entry("충남", List.of("충청남도", "충남")),
            Map.entry("전북", List.of("전북특별자치도", "전라북도", "전북")),
            Map.entry("전남", List.of("전라남도", "전남")),
            Map.entry("경북", List.of("경상북도", "경북")),
            Map.entry("경남", List.of("경상남도", "경남")),
            Map.entry("제주", List.of("제주특별자치도", "제주도", "제주")),
            Map.entry("세종", List.of("세종특별자치시", "세종")));

    private final AirQualitySnapshotCache cache;

    public AirQualityService(AirQualitySnapshotCache cache) {
        this.cache = cache;
    }

    public AirQualityReport get(double minLat, double maxLat,
                                     double minLon, double maxLon) {
        validateViewport(minLat, maxLat, minLon, maxLon);
        AirQualitySnapshotCache.Snapshot snapshot = cache.read();
        List<AirQualityReading> joined = join(snapshot.measurements(), snapshot.stations());
        if (joined.isEmpty() || joined.stream().noneMatch(AirQualityService::hasMeasurement)) {
            throw new UpstreamUnavailableException();
        }

        List<AirQualityReading> visible = joined.stream()
                .filter(station -> station.latitude() >= minLat && station.latitude() <= maxLat
                        && station.longitude() >= minLon && station.longitude() <= maxLon)
                .sorted(Comparator.comparing(AirQualityReading::stationName)
                        .thenComparingDouble(AirQualityReading::latitude)
                        .thenComparingDouble(AirQualityReading::longitude))
                .toList();
        String newest = timeRange(visible, true);
        if (newest == null) newest = timeRange(joined, true);
        String oldest = timeRange(visible, false);
        if (oldest == null) oldest = newest;
        if (newest == null) throw new UpstreamUnavailableException();
        return new AirQualityReport(newest, oldest, snapshot.stale(), SOURCE, visible);
    }

    private static List<AirQualityReading> join(
            List<AirQualityFeed.Measurement> measurements,
            List<AirQualityFeed.Station> stations) {
        Map<String, List<AirQualityFeed.Station>> stationsByName = new HashMap<>();
        for (AirQualityFeed.Station station : stations) {
            stationsByName.computeIfAbsent(key(station.name()), ignored -> new ArrayList<>())
                    .add(station);
        }

        Map<String, AirQualityReading> unique = new LinkedHashMap<>();
        for (AirQualityFeed.Measurement measurement : measurements) {
            AirQualityFeed.Station station = locate(measurement,
                    stationsByName.getOrDefault(key(measurement.name()), List.of()));
            if (station == null) continue;
            AirQualityReading mapped = new AirQualityReading(
                    measurement.name(), station.address(),
                    measurement.network() != null ? measurement.network() : station.network(),
                    station.latitude(), station.longitude(),
                    measurement.pm10Flag() == null ? measurement.pm10() : null,
                    measurement.pm25Flag() == null ? measurement.pm25() : null,
                    measurement.pm10Grade(), measurement.pm25Grade(),
                    measurement.pm10Flag(), measurement.pm25Flag(), measurement.observedAt());
            String identity = key(mapped.stationName()) + "@" + mapped.latitude() + "," + mapped.longitude();
            unique.merge(identity, mapped, AirQualityService::newer);
        }
        return List.copyOf(unique.values());
    }

    private static AirQualityFeed.Station locate(AirQualityFeed.Measurement measurement,
                                                  List<AirQualityFeed.Station> candidates) {
        if (candidates.isEmpty()) return null;
        List<AirQualityFeed.Station> remaining = candidates;
        if (measurement.address() != null) {
            List<AirQualityFeed.Station> exact = remaining.stream()
                    .filter(station -> key(station.address()).equals(key(measurement.address())))
                    .toList();
            if (!exact.isEmpty()) remaining = exact;
        }
        String expectedRegion = region(measurement.region());
        if (remaining.size() > 1 && expectedRegion != null) {
            List<AirQualityFeed.Station> regional = remaining.stream()
                    .filter(station -> expectedRegion.equals(region(station.address())))
                    .toList();
            if (!regional.isEmpty()) remaining = regional;
        }
        if (remaining.size() > 1 && measurement.network() != null) {
            List<AirQualityFeed.Station> network = remaining.stream()
                    .filter(station -> key(station.network()).equals(key(measurement.network())))
                    .toList();
            if (!network.isEmpty()) remaining = network;
        }
        return remaining.size() == 1 ? remaining.get(0) : null;
    }

    private static AirQualityReading newer(AirQualityReading left,
                                               AirQualityReading right) {
        if (left.observedAt() == null) return right;
        if (right.observedAt() == null) return left;
        return left.observedAt().compareTo(right.observedAt()) >= 0 ? left : right;
    }

    private static boolean hasMeasurement(AirQualityReading station) {
        return station.pm10Concentration() != null || station.pm25Concentration() != null;
    }

    private static String timeRange(List<AirQualityReading> stations, boolean newest) {
        Comparator<String> order = newest ? Comparator.naturalOrder() : Comparator.reverseOrder();
        return stations.stream().map(AirQualityReading::observedAt)
                .filter(Objects::nonNull).max(order).orElse(null);
    }

    private static String region(String source) {
        String normalized = key(source);
        if (normalized.isEmpty()) return null;
        for (Map.Entry<String, List<String>> entry : REGIONS.entrySet()) {
            if (entry.getValue().stream().map(AirQualityService::key)
                    .anyMatch(normalized::startsWith)) {
                return entry.getKey();
            }
        }
        return null;
    }

    private static String key(String source) {
        if (source == null) return "";
        StringBuilder result = new StringBuilder(source.length());
        source.toLowerCase(Locale.ROOT).codePoints()
                .filter(codePoint -> Character.isLetterOrDigit(codePoint))
                .forEach(result::appendCodePoint);
        String normalized = result.toString();
        return normalized.endsWith("측정소")
                ? normalized.substring(0, normalized.length() - "측정소".length())
                : normalized;
    }

    private static void validateViewport(double minLat, double maxLat,
                                         double minLon, double maxLon) {
        if (!Double.isFinite(minLat) || !Double.isFinite(maxLat)
                || !Double.isFinite(minLon) || !Double.isFinite(maxLon)
                || minLat < 32 || maxLat > 44 || minLon < 122 || maxLon > 134
                || minLat > maxLat || minLon > maxLon) {
            throw new IllegalArgumentException("Invalid air-quality viewport");
        }
    }
}
