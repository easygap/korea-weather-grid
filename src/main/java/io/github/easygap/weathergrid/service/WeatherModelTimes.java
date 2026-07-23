package io.github.easygap.weathergrid.service;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

final class WeatherModelTimes {

    static final ZoneId KST = ZoneId.of("Asia/Seoul");
    static final DateTimeFormatter COMPACT_HOUR = DateTimeFormatter.ofPattern("yyyyMMddHH");
    private static final DateTimeFormatter OFFSET_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX");
    private static final DateTimeFormatter UTC_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'");

    private WeatherModelTimes() { }

    static String kst(LocalDateTime time) {
        return time.atZone(KST).format(OFFSET_TIME);
    }

    static String utcFromKst(LocalDateTime time) {
        return time.atZone(KST).withZoneSameInstant(ZoneOffset.UTC).format(UTC_TIME);
    }

    static String utc(LocalDateTime time) {
        return time.format(UTC_TIME);
    }
}
