package io.github.easygap.weathergrid.dto;

import java.util.Objects;

/** Internal normalized station slot used before compact browser-array projection. */
public record StationSeriesSlot(
        int hour,
        double windSpeed,
        double windBearing,
        double solarRadiation,
        double airTemperature,
        String validTime) {

    public StationSeriesSlot {
        if (hour < 0 || hour > 48) throw new IllegalArgumentException("hour is outside 0..48");
        validTime = Objects.requireNonNull(validTime, "validTime");
    }
}
