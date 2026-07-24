package io.github.easygap.weathergrid.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WeatherGridWindowTest {

    @Test
    void stepFourExposesOnlyActuallySampledBoundaryCells() {
        WeatherGridWindow window = new WeatherGridWindow(4);

        assertEquals(37, window.columns());
        assertEquals(41, window.rows());
        assertEquals(149, window.lastX());
        assertEquals(161, window.lastY());
        assertEquals(161, window.yAtPayloadRow(0));
        assertEquals(1, window.yAtPayloadRow(40));
        assertTrue(window.northEast().latitude() > window.southWest().latitude());
    }

    @Test
    void invalidSamplingStepsFailDuringConfiguration() {
        assertThrows(IllegalArgumentException.class, () -> new WeatherGridWindow(0));
        assertThrows(IllegalArgumentException.class, () -> new WeatherGridWindow(500));
    }
}
