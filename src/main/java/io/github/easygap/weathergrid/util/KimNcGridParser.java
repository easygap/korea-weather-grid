package io.github.easygap.weathergrid.util;

import lombok.extern.slf4j.Slf4j;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * KIM 전구모델(NE57, 8km) NC 조회 API(nph-kim_nc_xy_txt2) 응답 파서
 *
 * 지표면 하향단파복사(dswrsfc) 등 단기예보 격자자료에 없는 변수를 KIM 전구모델에서 받는다.
 * 전구 격자(4320×2160, 0.0833°)는 한 변수에 122MB라 map=S(부분영역)로
 * 한반도 표출 영역만 크롭 수신한다. 응답 헤더가 크롭 인덱스를 echo하므로
 * 기대 영역과 일치하는지 검증한다.
 *
 * 격자 공식:
 *   lon(i) = (i-1) × (360/4320),  lat(j) = -90 + j × (180/2160)
 *
 * 응답은 크기·크롭 범위를 담은 주석 헤더와 남쪽부터 서→동으로 나열한
 * 숫자 행으로 구성된다. 회귀 테스트는 같은 문법의 합성 격자를 사용한다.
 */
@Slf4j
public final class KimNcGridParser {

    /** 전구 격자 크기 (NE57 후처리 0.0833° 등간격 위경도) */
    public static final int GLOBAL_NX = 4320;
    public static final int GLOBAL_NY = 2160;
    private static final double DEG = 360.0 / GLOBAL_NX;    // 0.08333° ≈ 8.3km

    /**
     * 한반도 크롭 영역 (전구 격자 1-base 인덱스, 양끝 포함)
     * 표출 범위(경도 124.0~132.325, 위도 31.8~39.0)를 여유 포함해 커버:
     * 경도 123.42~132.92, 위도 31.0~40.0
     */
    public static final int X_MIN = 1482;
    public static final int Y_MIN = 1452;
    public static final int X_MAX = 1596;
    public static final int Y_MAX = 1560;
    public static final int NX = X_MAX - X_MIN + 1;    // 115
    public static final int NY = Y_MAX - Y_MIN + 1;    // 109

    /** 물리값 0과 비관측·fill 셀을 구분하기 위한 내부 sentinel. */
    public static final double NO_DATA = -999.0;

    /** API 요청 sub 파라미터 (x_min,y_min,x_max,y_max) — 파서 검증값과 단일 출처 */
    public static final String SUB_PARAM = X_MIN + "," + Y_MIN + "," + X_MAX + "," + Y_MAX;

    /** "i = 115, j = 109" — 크롭 결과 크기 (변수명 라인은 EUC-KR이라 ASCII 부분만 매칭) */
    private static final Pattern DIMS = Pattern.compile("i\\s*=\\s*(\\d+),\\s*j\\s*=\\s*(\\d+)");
    private static final Pattern SUB_ECHO = Pattern.compile(
            "x_min\\s*=\\s*(\\d+),\\s*y_min\\s*=\\s*(\\d+),\\s*x_max\\s*=\\s*(\\d+),\\s*y_max\\s*=\\s*(\\d+)");

    private KimNcGridParser() {
    }

    /**
     * 크롭 응답 텍스트 → grid[row][col] (row 0 = 남쪽, col 0 = 서쪽)
     *
     * @return double[NY][NX] / 형식 불일치·오류 응답이면 null
     */
    public static double[][] parse(String response) {
        if (response == null || response.isBlank()) return null;
        if (response.contains("# ERROR")) {
            log.warn("KIM NC 응답 오류: {}", firstErrorLine(response));
            return null;
        }

        int ni = -1, nj = -1;
        boolean subChecked = false;

        double[][] grid = new double[NY][NX];
        int count = 0;

        for (String line : response.split("\n")) {
            line = line.trim();
            if (line.isEmpty()) continue;

            if (line.startsWith("#")) {
                if (ni < 0) {
                    Matcher m = DIMS.matcher(line);
                    if (m.find()) {
                        ni = Integer.parseInt(m.group(1));
                        nj = Integer.parseInt(m.group(2));
                        if (ni != NX || nj != NY) {
                            log.warn("KIM NC 크롭 크기 불일치: 기대 {}×{}, 응답 {}×{}", NX, NY, ni, nj);
                            return null;
                        }
                    }
                }
                Matcher s = SUB_ECHO.matcher(line);
                if (s.find()) {
                    subChecked = true;
                    if (Integer.parseInt(s.group(1)) != X_MIN || Integer.parseInt(s.group(2)) != Y_MIN
                            || Integer.parseInt(s.group(3)) != X_MAX || Integer.parseInt(s.group(4)) != Y_MAX) {
                        log.warn("KIM NC 크롭 영역 불일치: 기대 sub={}, 응답 {}", SUB_PARAM, line);
                        return null;
                    }
                }
                continue;
            }

            for (String token : line.split("\\s+")) {
                if (token.isEmpty()) continue;
                double v;
                try {
                    v = Double.parseDouble(token);
                } catch (NumberFormatException e) {
                    continue;    // 숫자가 아닌 토큰은 스킵
                }
                if (count >= NX * NY) {
                    log.warn("KIM NC 값 개수 초과: {}개 초과 수신", NX * NY);
                    return null;
                }
                // 결측 sentinel(-999)·NC fill(1e20) 방어만 수행한다.
                // 변수별 물리값의 의미가 다르므로 파서는 유효한 음수 부호를 보존한다.
                if (!Double.isFinite(v) || v <= -900 || v > 100000) v = NO_DATA;
                grid[count / NX][count % NX] = v;
                count++;
            }
        }

        if (ni < 0 || !subChecked) {
            log.warn("KIM NC 응답 헤더(크기·크롭 echo) 없음 — 형식 확인 필요");
            return null;
        }
        if (count != NX * NY) {
            log.warn("KIM NC 값 개수 불일치: 기대 {}개, 수신 {}개", NX * NY, count);
            return null;
        }
        return grid;
    }

    // ========== 격자 ↔ 위경도 ==========

    /** 위경도 → 크롭 배열 인덱스 [row, col]. 크롭 영역 밖이면 null */
    public static int[] latLonToIndex(double lat, double lon) {
        int i = (int) Math.round(lon / DEG) + 1;          // 전구 1-base
        int j = (int) Math.round((lat + 90.0) / DEG);
        if (i < X_MIN || i > X_MAX || j < Y_MIN || j > Y_MAX) return null;
        return new int[]{j - Y_MIN, i - X_MIN};
    }

    /** 크롭 배열 인덱스의 위경도 (검증·로그용) */
    public static double[] indexToLatLon(int row, int col) {
        double lon = (X_MIN + col - 1) * DEG;
        double lat = -90.0 + (Y_MIN + row) * DEG;
        return new double[]{lat, lon};
    }

    private static String firstErrorLine(String response) {
        for (String line : response.split("\n")) {
            if (line.contains("# ERROR")) return line.trim();
        }
        return "";
    }
}
