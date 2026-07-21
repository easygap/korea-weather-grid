package io.github.easygap.weathergrid.util;

/** 기상청 단기예보 DFS 격자와 위경도 간 좌표 변환 유틸리티. */
public class CoordinateConverter {

    /** 현재 분포도가 사용하는 DFS 표출 격자 범위. */
    public static final int FORECAST_NX_MIN = 5;
    public static final int FORECAST_NX_MAX = 149;
    public static final int FORECAST_NY_MIN = 1;
    public static final int FORECAST_NY_MAX = 162;

    private CoordinateConverter() {}

    /**
     * 위경도를 기상청 격자 좌표(nx, ny)로 변환
     * 기상청 API에서 사용하는 격자 좌표 체계
     */
    public static int[] latLonToGrid(double lat, double lon) {
        double RE = 6371.00877;     // 지구 반경 (km)
        double GRID = 5.0;          // 격자 간격 (km)
        double SLAT1 = 30.0;        // 투영 위도1 (degree)
        double SLAT2 = 60.0;        // 투영 위도2 (degree)
        double OLON = 126.0;        // 기준점 경도 (degree)
        double OLAT = 38.0;         // 기준점 위도 (degree)
        double XO = 43;             // 기준점 X 좌표 (GRID)
        double YO = 136;            // 기준점 Y 좌표 (GRID)

        double DEGRAD = Math.PI / 180.0;

        double re = RE / GRID;
        double slat1 = SLAT1 * DEGRAD;
        double slat2 = SLAT2 * DEGRAD;
        double olon = OLON * DEGRAD;
        double olat = OLAT * DEGRAD;

        double sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
        sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
        double sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
        sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
        double ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
        ro = re * sf / Math.pow(ro, sn);

        double ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
        ra = re * sf / Math.pow(ra, sn);
        double theta = lon * DEGRAD - olon;
        if (theta > Math.PI) theta -= 2.0 * Math.PI;
        if (theta < -Math.PI) theta += 2.0 * Math.PI;
        theta *= sn;

        int nx = (int) Math.floor(ra * Math.sin(theta) + XO + 0.5);
        int ny = (int) Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);

        return new int[]{nx, ny};
    }

    /**
     * 위경도가 현재 서비스의 분포도 지원 격자 안인지 확인한다.
     * 단순 위경도 사각형 대신 실제 DFS 셀 판정을 사용해 Worker와 경계 의미를 맞춘다.
     */
    public static boolean isInsideForecastGrid(double lat, double lon) {
        int[] grid = latLonToGrid(lat, lon);
        return isInsideForecastGrid(grid[0], grid[1]);
    }

    public static boolean isInsideForecastGrid(int nx, int ny) {
        return nx >= FORECAST_NX_MIN && nx <= FORECAST_NX_MAX
                && ny >= FORECAST_NY_MIN && ny <= FORECAST_NY_MAX;
    }

    /**
     * 기상청 격자 좌표(nx, ny)를 위경도로 변환
     */
    public static double[] gridToLatLon(int nx, int ny) {
        double RE = 6371.00877;
        double GRID = 5.0;
        double SLAT1 = 30.0;
        double SLAT2 = 60.0;
        double OLON = 126.0;
        double OLAT = 38.0;
        double XO = 43;
        double YO = 136;

        double DEGRAD = Math.PI / 180.0;
        double RADDEG = 180.0 / Math.PI;

        double re = RE / GRID;
        double slat1 = SLAT1 * DEGRAD;
        double slat2 = SLAT2 * DEGRAD;
        double olon = OLON * DEGRAD;
        double olat = OLAT * DEGRAD;

        double sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
        sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
        double sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
        sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
        double ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
        ro = re * sf / Math.pow(ro, sn);

        double xn = nx - XO;
        double yn = ro - ny + YO;
        double ra = Math.sqrt(xn * xn + yn * yn);
        if (sn < 0.0) ra = -ra;

        double alat = Math.pow(re * sf / ra, 1.0 / sn);
        alat = 2.0 * Math.atan(alat) - Math.PI * 0.5;

        double theta;
        if (Math.abs(xn) <= 0.0) {
            theta = 0.0;
        } else {
            if (Math.abs(yn) <= 0.0) {
                theta = Math.PI * 0.5;
                if (xn < 0.0) theta = -theta;
            } else {
                theta = Math.atan2(xn, yn);
            }
        }

        double alon = theta / sn + olon;

        return new double[]{alat * RADDEG, alon * RADDEG};
    }
}
