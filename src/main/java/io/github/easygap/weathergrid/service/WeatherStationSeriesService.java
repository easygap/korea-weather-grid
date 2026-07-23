package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.dto.StationSeriesSlot;
import io.github.easygap.weathergrid.exception.RequestRejectedException;
import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import io.github.easygap.weathergrid.geo.KmaDfsProjection;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Builds the map popup's compact station series from point-forecast or KIM products. */
@Service
public final class WeatherStationSeriesService {

    private static final Map<String, String> DETAILED_FORECAST_LABELS = Map.of(
            "pcp", "강수량", "sno", "신적설", "pty", "강수형태",
            "reh", "상대습도", "sky", "하늘상태", "wav", "파고");

    private final ForecastReleaseClock releases;
    private final StationForecastService pointForecast;
    private final KimSolarGridSource solar;
    private final WeatherRuntimeOptions options;

    public WeatherStationSeriesService(ForecastReleaseClock releases,
                                       StationForecastService pointForecast,
                                       KimSolarGridSource solar,
                                       WeatherRuntimeOptions options) {
        this.releases = releases;
        this.pointForecast = pointForecast;
        this.solar = solar;
        this.options = options;
    }

    public List<double[]> load(double latitude, double longitude, String baseDate,
                               String baseTime, String element) {
        String detailedLabel = DETAILED_FORECAST_LABELS.get(element);
        if (detailedLabel != null) {
            throw new RequestRejectedException(
                    detailedLabel + " 지점 시계열은 /api/weather/point-forecast를 사용해 주세요.");
        }

        ForecastReleaseClock.Release release = releases.atOrBefore(baseDate, baseTime);
        if ("swdn".equals(element)) {
            if (!solar.supportsPoint(latitude, longitude)) {
                throw new RequestRejectedException("일사강도 지원 범위 밖 지점");
            }
            return requireValues(solar.loadPointSeries(release, latitude, longitude));
        }
        if (!"tmp".equals(element) && !"wdws".equals(element)) {
            throw new RequestRejectedException("잘못된 element");
        }

        KmaDfsProjection.Cell cell = KmaDfsProjection.STANDARD.nearestCell(latitude, longitude);
        List<StationSeriesSlot> source = pointForecast.load(release, cell.x(), cell.y());
        List<double[]> series = new ArrayList<>(source.size());
        for (StationSeriesSlot slot : source) {
            series.add("tmp".equals(element)
                    ? new double[]{slot.airTemperature(), 0}
                    : new double[]{slot.windSpeed(), slot.windBearing()});
        }
        copyFirstVisibleValueIntoSlotZero(series);
        return requireValues(series);
    }

    private List<double[]> requireValues(List<double[]> series) {
        boolean populated = series.stream().anyMatch(slot -> slot != null && slot.length > 0
                && Double.isFinite(slot[0]) && slot[0] > -900 && slot[0] < 9000);
        if (!populated && !options.demoMode()) {
            throw new UpstreamUnavailableException("station data unavailable");
        }
        return series;
    }

    private static void copyFirstVisibleValueIntoSlotZero(List<double[]> series) {
        if (series.size() < 2) return;
        double first = series.get(0)[0];
        double next = series.get(1)[0];
        if ((first <= -900 || first >= 9000) && next > -900 && next < 9000) {
            series.set(0, series.get(1).clone());
        }
    }
}
