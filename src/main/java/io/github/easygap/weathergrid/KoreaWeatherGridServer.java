package io.github.easygap.weathergrid;

import org.springframework.boot.SpringApplication;

/** Command-line entry point for the self-hosted weather-grid server. */
public final class KoreaWeatherGridServer {

    private KoreaWeatherGridServer() { }

    public static void main(String... arguments) {
        SpringApplication application = new SpringApplication(WeatherGridRuntime.class);
        application.run(arguments);
    }
}
