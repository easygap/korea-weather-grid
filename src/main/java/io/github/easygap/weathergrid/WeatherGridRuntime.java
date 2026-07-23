package io.github.easygap.weathergrid;

import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Root configuration kept separate from the process launcher for testable startup. */
@SpringBootConfiguration(proxyBeanMethods = false)
@EnableAutoConfiguration
@ComponentScan(basePackageClasses = WeatherGridRuntime.class)
@EnableScheduling
public class WeatherGridRuntime { }
