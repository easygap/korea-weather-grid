package io.github.easygap.weathergrid.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** 지도 공급자 런타임 설정을 명시적으로 등록한다. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MapProviderProperties.class)
public class MapProviderConfiguration {
}
