package io.github.easygap.weathergrid.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Explicit runtime switches that affect public weather responses. */
@Component
public record WeatherRuntimeOptions(boolean demoMode) {

    public WeatherRuntimeOptions(@Value("${weather-grid.demo-mode:false}") boolean demoMode) {
        this.demoMode = demoMode;
    }
}
