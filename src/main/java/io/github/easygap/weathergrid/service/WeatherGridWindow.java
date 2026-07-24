package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.geo.KmaDfsProjection;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Spatial sampling contract shared by every public map-grid product. */
@Component
public final class WeatherGridWindow {

    private final int step;
    private final int minX = KmaDfsProjection.MAP_WINDOW.minX();
    private final int maxX = KmaDfsProjection.MAP_WINDOW.maxX();
    private final int minY = KmaDfsProjection.MAP_WINDOW.minY();
    private final int maxY = KmaDfsProjection.MAP_WINDOW.maxY();

    public WeatherGridWindow(@Value("${weather-grid.grid.step:1}") int step) {
        if (step < 1 || step > Math.max(maxX - minX, maxY - minY)) {
            throw new IllegalArgumentException("weather-grid.grid.step is outside the map window");
        }
        this.step = step;
    }

    public int step() {
        return step;
    }

    public int minX() {
        return minX;
    }

    public int minY() {
        return minY;
    }

    public int columns() {
        return (maxX - minX) / step + 1;
    }

    public int rows() {
        return (maxY - minY) / step + 1;
    }

    public int size() {
        return columns() * rows();
    }

    public int xAt(int column) {
        if (column < 0 || column >= columns()) throw new IndexOutOfBoundsException(column);
        return minX + column * step;
    }

    /** Public payload rows are ordered from north to south. */
    public int yAtPayloadRow(int row) {
        if (row < 0 || row >= rows()) throw new IndexOutOfBoundsException(row);
        return lastY() - row * step;
    }

    public int lastX() {
        return minX + (columns() - 1) * step;
    }

    public int lastY() {
        return minY + (rows() - 1) * step;
    }

    public KmaDfsProjection.GeoPoint southWest() {
        return KmaDfsProjection.STANDARD.cellCenter(minX, minY);
    }

    public KmaDfsProjection.GeoPoint northEast() {
        return KmaDfsProjection.STANDARD.cellCenter(lastX(), lastY());
    }
}
