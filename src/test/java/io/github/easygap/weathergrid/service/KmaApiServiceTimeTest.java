package io.github.easygap.weathergrid.service;

import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.TimeZone;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class KmaApiServiceTimeTest {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    @Test
    void latestReleaseAlwaysUsesKstEvenWhenJvmDefaultIsUtc() {
        TimeZone original = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
            KmaApiService service = new KmaApiService(mock(WebClient.class), MAPPER);
            ZonedDateTime before = ZonedDateTime.now(ZoneId.of("Asia/Seoul"));
            String[] actual = service.getLatestBaseDateTime();
            ZonedDateTime after = ZonedDateTime.now(ZoneId.of("Asia/Seoul"));

            assertTrue(Arrays.equals(actual, expected(before)) || Arrays.equals(actual, expected(after)));
        } finally {
            TimeZone.setDefault(original);
        }
    }

    @Test
    void blankAuthKeySkipsAllKmaNetworkPaths() {
        WebClient webClient = mock(WebClient.class);
        KmaApiService service = new KmaApiService(webClient, MAPPER);
        ReflectionTestUtils.setField(service, "authKey", " ");

        assertNull(service.fetchShortTermGridRaw("2026071602", "2026071603", "WSD"));
        assertNull(service.fetchKimNcGridRaw("2026071518", 9, "dswrsfc"));
        assertTrue(service.getShortTermForecast("20260716", "0200", 60, 127).isEmpty());
        verifyNoInteractions(webClient);
    }

    private static String[] expected(ZonedDateTime now) {
        for (int hour : new int[]{23, 20, 17, 14, 11, 8, 5, 2}) {
            if (now.getHour() > hour || (now.getHour() == hour && now.getMinute() >= 10)) {
                return new String[]{now.toLocalDate().format(DateTimeFormatter.BASIC_ISO_DATE), String.format("%02d00", hour)};
            }
        }
        return new String[]{now.minusDays(1).toLocalDate().format(DateTimeFormatter.BASIC_ISO_DATE), "2300"};
    }
}
