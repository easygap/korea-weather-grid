package io.github.easygap.weathergrid.config;

import org.springframework.boot.web.server.MimeMappings;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.server.servlet.ConfigurableServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Duration;

@Configuration(proxyBeanMethods = false)
public class StaticResourcesConfiguration implements WebMvcConfigurer {

    private static final Duration FRESHNESS = Duration.ofDays(1);
    private static final Duration STALE_REVALIDATION = Duration.ofDays(7);

    @Bean
    WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> geoJsonContentType() {
        return server -> {
            MimeMappings additionalTypes = new MimeMappings();
            additionalTypes.add("geojson", "application/geo+json");
            server.addMimeMappings(additionalTypes);
        };
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry resources) {
        CacheControl policy = CacheControl.maxAge(FRESHNESS)
                .cachePublic()
                .staleWhileRevalidate(STALE_REVALIDATION);
        resources.addResourceHandler("/static/**")
                .addResourceLocations("classpath:/static/")
                .setCacheControl(policy);
    }
}
