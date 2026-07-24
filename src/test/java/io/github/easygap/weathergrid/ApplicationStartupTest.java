package io.github.easygap.weathergrid;

import io.github.easygap.weathergrid.service.GridDataRepository;
import io.github.easygap.weathergrid.service.WeatherRequestBudget;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;

import static org.junit.jupiter.api.Assertions.assertNotNull;

@SpringBootTest(classes = WeatherGridRuntime.class, properties = {
        "weather-grid.demo-mode=true",
        "kma.api.auth-key="
})
class ApplicationStartupTest {

    @Autowired
    private ApplicationContext context;

    @Test
    void runtimeDiscoversTheIndependentRequestAndGridRepositories() {
        assertNotNull(context.getBean(GridDataRepository.class));
        assertNotNull(context.getBean(WeatherRequestBudget.class));
    }
}
