package io.github.easygap.weathergrid.config;

import org.springframework.boot.web.server.MimeMappings;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.server.servlet.ConfigurableServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.concurrent.TimeUnit;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Bean
    WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> geoJsonMimeMapping() {
        return factory -> {
            MimeMappings mappings = new MimeMappings();
            mappings.add("geojson", "application/geo+json");
            factory.addMimeMappings(mappings);
        };
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/static/**")
                .addResourceLocations("classpath:/static/")
                .setCacheControl(CacheControl.maxAge(1, TimeUnit.DAYS).cachePublic().staleWhileRevalidate(7, TimeUnit.DAYS));
    }
}
