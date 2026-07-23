package io.github.easygap.weathergrid.service;

import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Thin compatibility facade for the map controllers. */
@Service
public final class MapService {

    private final ForecastReleaseClock releases;
    private final WeatherGridService grids;
    private final WeatherStationSeriesService stations;

    public MapService(ForecastReleaseClock releases, WeatherGridService grids,
                      WeatherStationSeriesService stations) {
        this.releases = releases;
        this.grids = grids;
        this.stations = stations;
    }

    public Map<String, String> getLatestInfo() {
        ForecastReleaseClock.Release release = releases.current();
        Map<String, String> result = new LinkedHashMap<>();
        result.put("baseDate", release.compactDate());
        result.put("baseTime", release.compactTime());
        result.put("fileName", release.compactDate() + String.format("%02d_000", release.hour()));
        return result;
    }

    public Map<String, Object> getGridData(String baseDate, String baseTime,
                                           String element, int leadHours) {
        return grids.grid(baseDate, baseTime, element, leadHours);
    }

    public Map<String, Object> getDataStats(String baseDate, String baseTime,
                                            String element, int leadHours) {
        return grids.statistics(baseDate, baseTime, element, leadHours);
    }

    public List<double[]> getStationData(double latitude, double longitude,
                                         String baseDate, String baseTime, String element) {
        return stations.load(latitude, longitude, baseDate, baseTime, element);
    }
}
