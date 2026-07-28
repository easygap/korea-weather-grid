import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wranglerConfig = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('국내 상류 API는 서울 리전 Placement를 사용한다', () => {
    assert.match(wranglerConfig, /"placement"\s*:\s*\{\s*"region"\s*:\s*"aws:ap-northeast-2"\s*\}/);
    assert.doesNotMatch(wranglerConfig, /"placement"\s*:\s*\{\s*"host"\s*:/);
});
