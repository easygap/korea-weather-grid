package io.github.easygap.weathergrid.util;

import lombok.extern.slf4j.Slf4j;

/**
 * 단기예보(DFS) 격자자료 API 텍스트 응답 파서
 *
 * API: /api/typ01/cgi-bin/url/nph-dfs_shrt_grd (한 번 호출로 전 격자 반환)
 * 격자: 5km LCC, 가로 149(nx) × 세로 253(ny) = 37,697 지점
 *
 * 지원 형식:
 * - 헤더 없이 쉼표와 공백으로 구분된 고정 크기 값
 * - 남쪽 행(ny=1)부터 서→동 순서
 * - 비관측영역 -99 (호출자가 지정한 sentinel로 치환 가능)
 * 회귀 테스트는 결정적으로 생성한 합성 격자를 사용한다.
 */
@Slf4j
public class DfsGridParser {

    /** 단기예보 격자 크기 (동네예보 5km 격자 고정값) */
    public static final int NX = 149;
    public static final int NY = 253;

    /** 비관측영역 표기값 */
    private static final double MISSING = -99.0;

    /** 첫 데이터 행 = 남쪽(ny=1). */
    private static final boolean FIRST_ROW_IS_SOUTH = true;

    private DfsGridParser() {
    }

    /**
     * 격자자료 텍스트 응답을 [ny][nx] 2차원 배열로 파싱
     * 결측(-99)은 호환 기본값인 0으로 치환한다.
     *
     * @return grid[yi][xi], yi=0이 남쪽 / 파싱 실패(값 개수 불일치 등) 시 null
     */
    public static double[][] parse(String response) {
        return parse(response, 0.0);
    }

    /**
     * 결측(-99 이하)과 NaN/±Infinity를 지정 값으로 치환하며 파싱한다.
     * 실제 0은 무풍·야간·0℃ 모두에서 유효하므로 운영 조회는 -999 같은
     * 별도 sentinel을 넘겨 표출·통계 계층까지 결측을 보존한다.
     */
    public static double[][] parse(String response, double missingAs) {
        if (response == null || response.isEmpty()) return null;

        double[] values = new double[NX * NY];
        int count = 0;

        for (String line : response.split("\n")) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;   // 헤더/주석 스킵

            // 쉼표·공백 혼용 대비 통합 토큰화
            for (String token : line.split("[,\\s]+")) {
                if (token.isEmpty()) continue;
                double v;
                try {
                    v = Double.parseDouble(token);
                } catch (NumberFormatException e) {
                    continue;   // 숫자가 아닌 잔여 토큰(단위 표기 등) 무시
                }
                if (count >= values.length) {
                    log.warn("격자 값이 기대 개수({})를 초과 — 응답 형식 확인 필요", values.length);
                    return null;
                }
                values[count++] = (!Double.isFinite(v) || v <= MISSING) ? missingAs : v;
            }
        }

        if (count != NX * NY) {
            log.warn("격자 값 개수 불일치: expected={}, actual={}", NX * NY, count);
            return null;
        }

        double[][] grid = new double[NY][NX];
        for (int i = 0; i < count; i++) {
            int row = i / NX;
            int yi = FIRST_ROW_IS_SOUTH ? row : (NY - 1 - row);
            grid[yi][i % NX] = values[i];
        }
        return grid;
    }
}
