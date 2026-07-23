package io.github.easygap.weathergrid.integration;

import io.github.easygap.weathergrid.exception.UpstreamUnavailableException;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TrafficCameraFeedContractTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void decodesTheDocumentedHttpsHlsFieldsAndCreatesOpaqueStableIds() throws Exception {
        TrafficCameraGateway gateway = mock(TrafficCameraGateway.class);
        when(gateway.fetch(37.0, 37.25, 126.75, 127.0)).thenReturn(JSON.readTree("""
                {"response":{"datacount":2,"data":[
                  {"roadsectionid":"R-1","filecreatetime":"20260722123000",
                   "cctvtype":"4","cctvurl":"https://cctvsec.ktict.co.kr/live/a.m3u8",
                   "cctvresolution":"1280x720","coordx":"126.91","coordy":"37.11",
                   "cctvformat":"HLS","cctvname":"가 지점"},
                  {"roadsectionid":"R-2","filecreatetime":"20260722123000",
                   "cctvtype":"4","cctvurl":"https://cctvsec.ktict.co.kr/live/b.m3u8",
                   "cctvresolution":"1920x1080","coordx":126.92,"coordy":37.12,
                   "cctvformat":"hls","cctvname":"나 지점"}
                ]}}
                """));
        TrafficCameraFeed feed = new TrafficCameraFeed(gateway);

        TrafficCameraFeed.Batch batch = feed.retrieve(37.0, 37.25, 126.75, 127.0);

        assertEquals(2, batch.cameras().size());
        assertEquals("R-1|가 지점@37.1100000,126.9100000", batch.cameras().get(0).id());
        assertEquals(37.11, batch.cameras().get(0).latitude());
        assertEquals("https://cctvsec.ktict.co.kr/live/b.m3u8",
                batch.cameras().get(1).streamUrl());
        assertEquals(batch.cameras().get(0).id(),
                feed.retrieve(37.0, 37.25, 126.75, 127.0).cameras().get(0).id());
    }

    @Test
    void dropsUnsafeOrContractBreakingItemsAndMarksTheBatchTruncated() throws Exception {
        TrafficCameraGateway gateway = mock(TrafficCameraGateway.class);
        when(gateway.fetch(37.0, 37.25, 126.75, 127.0)).thenReturn(JSON.readTree("""
                {"datacount":4,"data":[
                  {"cctvtype":"4","cctvurl":"https://cctvsec.ktict.co.kr/live/good.m3u8",
                   "coordx":"126.9","coordy":"37.1","cctvformat":"HLS","cctvname":"정상"},
                  {"cctvtype":"1","cctvurl":"https://cctvsec.ktict.co.kr/live/type.m3u8",
                   "coordx":"126.9","coordy":"37.1","cctvformat":"HLS","cctvname":"잘못된 유형"},
                  {"cctvtype":"4","cctvurl":"https://user@cctvsec.ktict.co.kr/live/user.m3u8",
                   "coordx":"126.9","coordy":"37.1","cctvformat":"HLS","cctvname":"사용자정보"},
                  {"cctvtype":"4","cctvurl":"https://example.com/live/host.m3u8",
                   "coordx":"126.9","coordy":"37.1","cctvformat":"HLS","cctvname":"외부 호스트"}
                ]}
                """));

        TrafficCameraFeed.Batch batch = new TrafficCameraFeed(gateway)
                .retrieve(37.0, 37.25, 126.75, 127.0);

        assertEquals(1, batch.cameras().size());
        assertEquals("정상", batch.cameras().get(0).name());
        assertTrue(batch.truncated());
    }

    @Test
    void rejectsMissingCountsProviderErrorsAndAllInvalidDeclaredData() throws Exception {
        TrafficCameraGateway gateway = mock(TrafficCameraGateway.class);
        TrafficCameraFeed feed = new TrafficCameraFeed(gateway);

        when(gateway.fetch(37.0, 37.25, 126.75, 127.0))
                .thenReturn(JSON.readTree("{\"data\":[]}"));
        assertThrows(UpstreamUnavailableException.class,
                () -> feed.retrieve(37.0, 37.25, 126.75, 127.0));

        when(gateway.fetch(37.0, 37.25, 126.75, 127.0)).thenReturn(JSON.readTree(
                "{\"response\":{\"header\":{\"resultCode\":\"000\"},\"datacount\":0}}"));
        assertThrows(UpstreamUnavailableException.class,
                () -> feed.retrieve(37.0, 37.25, 126.75, 127.0));

        when(gateway.fetch(37.0, 37.25, 126.75, 127.0)).thenReturn(JSON.readTree("""
                {"datacount":1,"data":[{"cctvtype":"4","cctvname":"broken"}]}
                """));
        assertThrows(UpstreamUnavailableException.class,
                () -> feed.retrieve(37.0, 37.25, 126.75, 127.0));
    }
}
