import assert from 'node:assert/strict';
import test from 'node:test';

import {
    containsDeniedTerm,
    findForbiddenChartRuntimes,
    findSecretIndicators,
    isForbiddenPath,
    parseDenylist
} from './publication-rules.mjs';

test('공개 금지 경로는 로컬 설정·키·생성된 배포 자산만 차단한다', () => {
    const forbidden = [
        '.env',
        '.env.example.local',
        'cloudflare/.env.production',
        'src/main/resources/application-local.yml',
        'cloudflare/public/static/app.js',
        'cloudflare/public/internal/snapshot.json',
        'keys/deploy.pem',
        'id_ed25519'
    ];
    const allowed = [
        '.env.example',
        'src/main/resources/application.yml',
        'cloudflare/public/index.html',
        'src/main/resources/static/favicon.svg',
        'SECURITY.md'
    ];
    assert.ok(forbidden.every(isForbiddenPath));
    assert.ok(allowed.every((path) => !isForbiddenPath(path)));
});

test('금지 차트 런타임은 이름 변형을 찾고 자체 SVG 설명은 허용한다', () => {
    assert.deepEqual(findForbiddenChartRuntimes('window.Highcharts.chart()'), ['Highcharts']);
    assert.deepEqual(findForbiddenChartRuntimes('modules/windbarb.js'), ['Highcharts Windbarb']);
    assert.deepEqual(findForbiddenChartRuntimes('<script src="chart.min.js">'), ['Chart.js']);
    assert.deepEqual(findForbiddenChartRuntimes('first-party SVG station chart renderer'), []);
});

test('Secret 탐지는 값 노출 없이 일반 대입과 공급자 prefix를 분류한다', () => {
    const generic = 'service' + 'Key="' + 'a'.repeat(32) + '"';
    const githubClassic = 'gh' + 'p_' + 'a'.repeat(36);
    const githubFineGrained = 'github_' + 'pat_' + 'a'.repeat(40);
    const githubStateless = 'gh' + 's_123456_' + 'a'.repeat(20) + '.bbb.ccc';
    const aws = 'AK' + 'IA' + 'A'.repeat(16);
    const google = 'AI' + 'za' + 'A'.repeat(35);
    const privateKey = '-----BEGIN ' + 'PRIVATE KEY-----';

    assert.deepEqual(findSecretIndicators(generic), ['generic-key-assignment']);
    assert.deepEqual(findSecretIndicators(githubClassic), ['github-token']);
    assert.deepEqual(findSecretIndicators(githubFineGrained), ['github-token']);
    assert.deepEqual(findSecretIndicators(githubStateless), ['github-token']);
    assert.deepEqual(findSecretIndicators(aws), ['aws-access-key-id']);
    assert.deepEqual(findSecretIndicators(google), ['google-api-key']);
    assert.deepEqual(findSecretIndicators(privateKey), ['private-key-block']);
});

test('환경 변수와 짧은 합성 placeholder는 Secret으로 오인하지 않는다', () => {
    const safe = [
        'serviceKey: ${DATA_GO_KR_SERVICE_KEY}',
        'const apiKey = process.env.API_KEY;',
        'secretKey: "fixture-only"',
        'Authorization: Bearer synthetic-test-token'
    ];
    assert.ok(safe.every((text) => findSecretIndicators(text).length === 0));
});

test('로컬 식별자 목록은 주석·빈 줄·중복을 제거하고 대소문자 없이 검사한다', () => {
    const terms = parseDenylist([
        '# local only',
        '',
        'Former-Project',
        'internal.example',
        'former-project'
    ].join('\n'));
    assert.deepEqual(terms, ['former-project', 'internal.example']);
    assert.equal(containsDeniedTerm('prefix FORMER-PROJECT suffix', terms), true);
    assert.equal(containsDeniedTerm('independent public implementation', terms), false);
});
