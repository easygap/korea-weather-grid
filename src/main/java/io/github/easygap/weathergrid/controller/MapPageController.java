package io.github.easygap.weathergrid.controller;

import io.github.easygap.weathergrid.service.MapService;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

import java.util.Map;

/** Renders the server-hosted shell with the latest available release metadata. */
@Controller
public final class MapPageController {

    private final MapService maps;

    public MapPageController(MapService maps) {
        this.maps = maps;
    }

    @GetMapping("/")
    public String index(Model model) {
        Map<String, String> release = maps.getLatestInfo();
        model.addAttribute("fileName", release.get("fileName"));
        model.addAttribute("baseDate", release.get("baseDate"));
        model.addAttribute("baseTime", release.get("baseTime"));
        return "weather-grid";
    }
}
