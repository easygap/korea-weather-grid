// 프론트 정적 자산을 Spring 리소스에서 복사 (단일 소스 유지 — public/static은 커밋하지 않음)
import { copyFileSync, cpSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderStaticShell } from './jsp-shell.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src', 'main', 'resources', 'static');
const dst = join(here, 'public', 'static');
const jspSource = join(here, '..', 'src', 'main', 'webapp', 'WEB-INF', 'jsp', 'weather-grid.jsp');
const shellTarget = join(here, 'public', 'index.html');

if (!existsSync(src) || !existsSync(jspSource)) {
    console.error('원본 프론트 자산 없음:', !existsSync(src) ? src : jspSource);
    process.exit(1);
}

// 운영 정적 셸도 JSP에서 생성해 DOM·접근성 속성·자산 버전이 갈라지지 않게 한다.
// 서버에서만 필요한 JSP 지시문과 초기 발표시각 속성은 브라우저 부트스트랩이 채운다.
const staticShell = renderStaticShell(jspSource);
writeFileSync(shellTarget, staticShell);
console.log('정적 셸 생성 완료:', jspSource, '→', shellTarget);

rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
const rootFavicons = ['favicon.svg'];
for (const favicon of rootFavicons) {
    copyFileSync(join(src, favicon), join(here, 'public', favicon));
}
for (const favicon of rootFavicons) {
    rmSync(join(dst, favicon), { force: true });
}
for (const staleFavicon of ['favicon.ico', 'favicon-180.png', 'favicon-512.png']) {
    rmSync(join(here, 'public', staleFavicon), { force: true });
    rmSync(join(dst, staleFavicon), { force: true });
}
console.log('복사 완료:', src, '→', dst);

// 이전 빌드에서 생성된 비공개 데이터가 정적 배포 디렉터리에 남지 않게 한다.
rmSync(join(here, 'public', 'internal'), { recursive: true, force: true });
