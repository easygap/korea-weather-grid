package io.github.easygap.weathergrid.dto;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PublicContractModelTest {

    private final ObjectMapper json = JsonMapper.builder().build();

    @Test
    void airQualityUsesStableJsonNamesInsteadOfInternalDomainNames() throws Exception {
        AirQualityReading reading = new AirQualityReading(
                "종로구", "서울특별시 종로구", "도시대기", 37.57, 127.01,
                22.0, null, 1, null, null, "점검중", "2026-07-22 10:00");
        AirQualityReport report = new AirQualityReport(
                "2026-07-22 10:00", "2026-07-22 09:00", true, "AirKorea", List.of(reading));

        JsonNode root = json.valueToTree(report);

        assertEquals("2026-07-22 10:00", root.get("dataTime").stringValue());
        assertEquals("2026-07-22 09:00", root.get("dataTimeFrom").stringValue());
        assertTrue(root.get("stale").asBoolean());
        assertFalse(root.has("newestObservation"));
        JsonNode station = root.get("stations").get(0);
        assertEquals("종로구", station.get("name").stringValue());
        assertTrue(station.has("pm25"));
        assertTrue(station.get("pm25").isNull());
        assertFalse(station.has("stationName"));
    }

    @Test
    void cameraAndPointForecastKeepTheirBrowserSchemas() {
        TrafficCameraReport cameras = new TrafficCameraReport(
                "2026-07-22T03:00:00Z", false, false, "ITS",
                List.of(new TrafficCameraView(
                        "camera-1", "한강", 37.5, 127,
                        "https://example.test/live.m3u8", "HLS", "1280x720", null, "R-1")));
        PointForecastReport forecast = new PointForecastReport(
                "20260722", "0200", 37.5, 127, "기상청 단기예보",
                List.of(new PointForecastHour(
                        1, "202607220300", 18.2, 70.0, 0.0,
                        "강수없음", "적설없음", 1, "맑음", 0, "없음",
                        null, 2.3, 270.0)));

        JsonNode cameraJson = json.valueToTree(cameras);
        JsonNode forecastJson = json.valueToTree(forecast);

        assertEquals("camera-1", cameraJson.get("cctvs").get(0).get("id").stringValue());
        assertEquals("HLS", cameraJson.get("cctvs").get(0).get("format").stringValue());
        assertFalse(cameraJson.has("collectedAt"));
        assertEquals("20260722", forecastJson.get("baseDate").stringValue());
        assertEquals(18.2, forecastJson.get("items").get(0).get("temperature").asDouble());
        assertEquals(270.0, forecastJson.get("items").get(0).get("windDirection").asDouble());
        assertFalse(forecastJson.has("releaseDate"));
    }

    @Test
    void responseCollectionsAreDefensivelyCopied() {
        List<TrafficCameraView> mutable = new ArrayList<>();
        TrafficCameraReport report = new TrafficCameraReport(
                "2026-07-22T03:00:00Z", false, false, "ITS", mutable);

        mutable.add(new TrafficCameraView(
                "late", "late", 37.5, 127,
                "https://example.test/live.m3u8", "HLS", null, null, null));

        assertTrue(report.cameras().isEmpty());
        assertThrows(UnsupportedOperationException.class,
                () -> report.cameras().add(mutable.get(0)));
    }

    @Test
    void numericAndCoordinateInvariantsRejectImpossibleModels() {
        NumericSummary summary = new NumericSummary(0, 3.4, 9.8);

        assertEquals(0, summary.minimum());
        assertThrows(IllegalArgumentException.class, () -> new NumericSummary(10, 4, 2));
        assertThrows(IllegalArgumentException.class, () -> new TrafficCameraView(
                "id", "name", Double.NaN, 127,
                "https://example.test/live.m3u8", "HLS", null, null, null));
        assertThrows(IllegalArgumentException.class, () -> new StationSeriesSlot(
                49, 0, 0, 0, 0, "202607240300"));
    }
}
