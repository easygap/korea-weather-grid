import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Search = require('../../src/main/resources/static/js/weather-grid-search-state.js');

const stations = [
    { name: '서울 특별시', lat: 37.56, lon: 126.98 },
    { name: '제주특별자치도', lat: 33.38, lon: 126.55 },
    { name: '부산광역시', lat: 35.18, lon: 129.07 }
];

test('검색어는 호환 문자·공백·대소문자를 한 규칙으로 정규화한다', () => {
    assert.equal(Search.normalizeQuery(' ＳＥＯＵＬ  역 '), 'seoul역');
    assert.equal(Search.normalizeQuery(null), '');
});

test('부분 검색은 원래 순서를 유지하고 불변 결과를 반환한다', () => {
    const results = Search.suggestions(stations, '특별', 20);
    assert.deepEqual(results.map((station) => station.name), ['서울 특별시', '제주특별자치도']);
    assert.equal(Object.isFrozen(results), true);
    assert.equal(Object.isFrozen(results[0]), true);
});

test('검색 결과 상한은 양수 50개 이내로 제한한다', () => {
    const many = Array.from({ length: 70 }, (_, index) => ({
        name: `테스트${index}`,
        lat: 36,
        lon: 127
    }));
    assert.equal(Search.suggestions(many, '테스트', 100).length, 50);
    assert.equal(Search.suggestions(many, '테스트', 3).length, 3);
});

test('잘못된 이름과 좌표를 가진 검색 후보는 제외한다', () => {
    const results = Search.suggestions([
        { name: '', lat: 37, lon: 127 },
        { name: '위도오류', lat: 91, lon: 127 },
        { name: '경도오류', lat: 37, lon: 181 },
        { name: '정상', lat: 37, lon: 127 }
    ], '오류');
    assert.deepEqual(results, []);
    assert.equal(Search.exactMatch([{ name: '정상', lat: 37, lon: 127 }], '정 상').name, '정상');
});

test('정확 검색은 공백 차이를 허용하지만 부분 일치는 선택하지 않는다', () => {
    assert.equal(Search.exactMatch(stations, '서울특별시').name, '서울 특별시');
    assert.equal(Search.exactMatch(stations, '서울'), null);
    assert.equal(Search.exactMatch(stations, ''), null);
});

test('키보드 이동은 처음과 끝에서 순환한다', () => {
    assert.equal(Search.moveIndex(-1, 3, 'next'), 0);
    assert.equal(Search.moveIndex(2, 3, 'next'), 0);
    assert.equal(Search.moveIndex(0, 3, 'previous'), 2);
    assert.equal(Search.moveIndex(1, 0, 'next'), -1);
});

test('검색 상태 안내는 결과 수와 복구 가능한 빈 결과를 설명한다', () => {
    assert.equal(Search.status('서울', 2), '검색 제안 2개가 있습니다.');
    assert.equal(Search.status('없는 곳', 0), '“없는 곳”와 일치하는 대표 지역이 없습니다.');
    assert.equal(Search.status(' ', 0), '');
    assert.equal(Search.selectionStatus('부산광역시'), '“부산광역시” 예보를 열었습니다.');
    assert.equal(Search.selectionStatus(' '), '');
});
