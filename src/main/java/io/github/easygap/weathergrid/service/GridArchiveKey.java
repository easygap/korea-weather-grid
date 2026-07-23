package io.github.easygap.weathergrid.service;

import java.nio.file.Path;
import java.util.Set;

/** Validated relative address owned by the raw weather-grid archive. */
record GridArchiveKey(String family, String runHour, String fileName) {

    private static final Set<String> FAMILIES = Set.of("dfs", "kim");

    GridArchiveKey {
        if (!FAMILIES.contains(family)
                || runHour == null || !runHour.matches("\\d{10}")
                || fileName == null || !fileName.matches("[A-Za-z0-9._-]{1,80}")) {
            throw new IllegalArgumentException("Invalid grid archive address");
        }
    }

    static GridArchiveKey dfs(String issuedAt, String validAt, String variable) {
        return new GridArchiveKey("dfs", issuedAt, variable + "-" + validAt + ".txt");
    }

    static GridArchiveKey kimSolar(String modelRun, int forecastHour) {
        return new GridArchiveKey("kim", modelRun, "solar-" + String.format("%03d", forecastHour) + ".txt");
    }

    Path relativePath() {
        return Path.of(family, runHour, fileName);
    }
}
