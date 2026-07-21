package io.github.easygap.weathergrid;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {
        "weather-grid.demo-mode=true",
        "kma.api.auth-key="
})
class WeatherGridApplicationTest {

    @Test
    void contextLoads() {
    }
}
