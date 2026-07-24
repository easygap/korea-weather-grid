package io.github.easygap.weathergrid.geo;

/**
 * 기상청 동네예보 5 km 격자의 Lambert conformal conic 투영.
 *
 * <p>투영 상수는 기상청 「동네예보 격자영역 정보」(2024-03-05)에 공개된 값이다.
 * 이 클래스는 해당 수치 사양과 표준 투영식을 바탕으로 독립 작성되었다.</p>
 *
 * @see <a href="https://apihub.kma.go.kr/getAttachFile.do?fileName=%2820240305%29%EB%8F%99%EB%84%A4%EC%98%88%EB%B3%B4+%EA%B2%A9%EC%9E%90%EC%98%81%EC%97%AD+%EC%A0%95%EB%B3%B4.pdf">기상청 동네예보 격자영역 정보</a>
 */
public final class KmaDfsProjection {

    public static final KmaDfsProjection STANDARD = new KmaDfsProjection(
            6_371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43.0, 136.0);

    /** 현재 지도 제품이 노출하는 DFS 셀 범위. */
    public static final CellWindow MAP_WINDOW = new CellWindow(5, 149, 1, 162);

    private static final double HALF_PI = Math.PI / 2.0;
    private static final double QUARTER_PI = Math.PI / 4.0;
    private static final double FULL_TURN = Math.PI * 2.0;

    private final double scaledEarthRadius;
    private final double originLongitudeRadians;
    private final double originX;
    private final double originY;
    private final double coneExponent;
    private final double coneScale;
    private final double originRadius;

    private KmaDfsProjection(double earthRadiusKm, double cellSizeKm,
                             double southernParallelDegrees, double northernParallelDegrees,
                             double originLongitudeDegrees, double originLatitudeDegrees,
                             double originX, double originY) {
        this.scaledEarthRadius = earthRadiusKm / cellSizeKm;
        this.originLongitudeRadians = Math.toRadians(originLongitudeDegrees);
        this.originX = originX;
        this.originY = originY;

        double southernParallel = Math.toRadians(southernParallelDegrees);
        double northernParallel = Math.toRadians(northernParallelDegrees);
        double originLatitude = Math.toRadians(originLatitudeDegrees);

        double tangentRatio = tangentAt(northernParallel) / tangentAt(southernParallel);
        this.coneExponent = Math.log(Math.cos(southernParallel) / Math.cos(northernParallel))
                / Math.log(tangentRatio);
        this.coneScale = Math.cos(southernParallel)
                * Math.pow(tangentAt(southernParallel), coneExponent) / coneExponent;
        this.originRadius = radiusAt(originLatitude);
    }

    /** 위경도에서 가장 가까운 정수 DFS 셀을 반환한다. */
    public Cell nearestCell(double latitude, double longitude) {
        requireGeographicCoordinate(latitude, longitude);

        double latitudeRadians = Math.toRadians(latitude);
        double deltaLongitude = Math.IEEEremainder(
                Math.toRadians(longitude) - originLongitudeRadians, FULL_TURN);
        double radius = radiusAt(latitudeRadians);
        double angle = coneExponent * deltaLongitude;

        int x = roundCell(radius * Math.sin(angle) + originX);
        int y = roundCell(originRadius - radius * Math.cos(angle) + originY);
        return new Cell(x, y);
    }

    /** 정수 DFS 셀 중심을 위경도로 역투영한다. */
    public GeoPoint cellCenter(int x, int y) {
        double east = x - originX;
        double north = originRadius - y + originY;
        double radius = Math.hypot(east, north);
        if (coneExponent < 0.0) radius = -radius;

        double latitude;
        double angle;
        if (radius == 0.0) {
            latitude = Math.copySign(HALF_PI, coneExponent);
            angle = 0.0;
        } else {
            double tangent = Math.pow(scaledEarthRadius * coneScale / radius,
                    1.0 / coneExponent);
            latitude = 2.0 * Math.atan(tangent) - HALF_PI;
            angle = Math.atan2(east, north);
        }

        double longitude = originLongitudeRadians + angle / coneExponent;
        return new GeoPoint(Math.toDegrees(latitude), normalizeLongitude(Math.toDegrees(longitude)));
    }

    public boolean isInsideMapWindow(double latitude, double longitude) {
        return MAP_WINDOW.contains(nearestCell(latitude, longitude));
    }

    private double radiusAt(double latitudeRadians) {
        return scaledEarthRadius * coneScale
                / Math.pow(tangentAt(latitudeRadians), coneExponent);
    }

    private static double tangentAt(double latitudeRadians) {
        return Math.tan(QUARTER_PI + latitudeRadians / 2.0);
    }

    private static int roundCell(double value) {
        return (int) Math.floor(value + 0.5);
    }

    private static double normalizeLongitude(double longitude) {
        double normalized = Math.IEEEremainder(longitude, 360.0);
        return normalized == -180.0 ? 180.0 : normalized;
    }

    private static void requireGeographicCoordinate(double latitude, double longitude) {
        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)
                || latitude <= -90.0 || latitude >= 90.0) {
            throw new IllegalArgumentException("유효한 위경도가 필요합니다");
        }
    }

    public record Cell(int x, int y) { }

    public record GeoPoint(double latitude, double longitude) { }

    public record CellWindow(int minX, int maxX, int minY, int maxY) {
        public CellWindow {
            if (minX > maxX || minY > maxY) {
                throw new IllegalArgumentException("격자 범위의 최솟값이 최댓값보다 클 수 없습니다");
            }
        }

        public boolean contains(Cell cell) {
            return contains(cell.x(), cell.y());
        }

        public boolean contains(int x, int y) {
            return x >= minX && x <= maxX && y >= minY && y <= maxY;
        }
    }
}
