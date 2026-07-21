package io.github.easygap.weathergrid;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling    // 격자 디스크 캐시 보존기간 정리(GridCacheService.sweepOldCache)
public class WeatherGridApplication {

    public static void main(String[] args) {
        SpringApplication.run(WeatherGridApplication.class, args);
    }
}
