import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
const versionAtFullTraffic = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@100%$/i;

if (process.argv.length !== 3 || !versionAtFullTraffic.test(target || '')) {
    console.error('사용법: npm run deploy -- <검증한-RC-버전-UUID>@100%');
    process.exit(1);
}

// .cmd 파일은 Windows의 shell:false spawn에서 EINVAL이 날 수 있다. 설치된
// Wrangler의 Node 엔트리를 직접 호출하면 셸 해석 없이 모든 플랫폼에서 동일하다.
const wranglerCli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
function runWrangler(args, label) {
    const result = spawnSync(process.execPath, [wranglerCli, ...args], {
        stdio: 'inherit',
        shell: false
    });
    if (result.error) {
        console.error(`${label}에 실패했습니다:`, result.error.message);
        process.exit(1);
    }
    if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

runWrangler(['versions', 'deploy', target, '--yes'], '버전 배포');

// versions upload/deploy 흐름에서는 route·Cron Trigger가 자동 반영되지 않는다.
// 검증한 버전을 100% 전환한 직후 wrangler.jsonc의 트리거를 운영에 동기화한다.
runWrangler(['triggers', 'deploy'], 'Cron Trigger 반영');
