package io.github.easygap.weathergrid.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Set;

/** Development-server status for hazard data that is connected only by the deployment Worker. */
@RestController
public final class HazardStatusController {

    private static final HazardStatus UNAVAILABLE = new HazardStatus(
            "bora.warnings/v1", "기상청 기상특보", "unavailable", List.of());

    private final PublicRequestPolicy requests;

    public HazardStatusController(PublicRequestPolicy requests) {
        this.requests = requests;
    }

    @GetMapping("/api/hazards/warnings")
    public ResponseEntity<HazardStatus> warnings(HttpServletRequest request) {
        requests.requireExactQuery(request, Set.of());
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=60, stale-while-revalidate=60")
                .body(UNAVAILABLE);
    }

    public record HazardStatus(String schema, String source, String status, List<Object> warnings) {
        public HazardStatus {
            warnings = List.copyOf(warnings);
        }
    }
}
