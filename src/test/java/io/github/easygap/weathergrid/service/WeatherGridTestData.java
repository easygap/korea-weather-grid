package io.github.easygap.weathergrid.service;

import io.github.easygap.weathergrid.util.KimGridGeometry;

import java.util.Arrays;

final class WeatherGridTestData {

    private WeatherGridTestData() { }

    static double[][] dfs(double value) {
        return matrix(253, 149, value);
    }

    static double[][] kim(double value) {
        return matrix(KimGridGeometry.ROWS, KimGridGeometry.COLUMNS, value);
    }

    static double[][] matrix(int rows, int columns, double value) {
        double[][] result = new double[rows][columns];
        for (double[] row : result) Arrays.fill(row, value);
        return result;
    }
}
