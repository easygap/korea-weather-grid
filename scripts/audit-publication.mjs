#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import process from 'node:process';

import {
    containsDeniedTerm,
    findForbiddenChartRuntimes,
    findSecretIndicators,
    isForbiddenPath,
    parseDenylist
} from './publication-rules.mjs';

const repository = resolve(import.meta.dirname, '..');
const releaseMode = process.argv.includes('--release');
const refArgument = process.argv.find((argument) => argument.startsWith('--ref='));
const inspectedRef = refArgument?.slice('--ref='.length);
const failures = [];
const warnings = [];

function git(...args) {
    return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}

function gitBytes(...args) {
    return execFileSync('git', args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
}

function fail(message) {
    failures.push(message);
}

function warn(message) {
    warnings.push(message);
}

if (refArgument && !inspectedRef) {
    throw new Error('--ref에는 검사할 Git commit을 지정해야 합니다.');
}

if (inspectedRef) git('rev-parse', '--verify', `${inspectedRef}^{commit}`);

const listed = inspectedRef
    ? gitBytes('ls-tree', '-r', '-z', '--name-only', inspectedRef)
    : execFileSync('git', [
        'ls-files', '--cached', '--others', '--exclude-standard', '-z'
    ], { cwd: repository });
const files = listed.toString('utf8').split('\0').filter(Boolean)
    .filter((path) => inspectedRef || existsSync(resolve(repository, path)));
const fileSet = new Set(files);

function hasFile(path) {
    return inspectedRef ? fileSet.has(path) : existsSync(resolve(repository, path));
}

function readBytes(path) {
    return inspectedRef
        ? gitBytes('show', `${inspectedRef}:${path}`)
        : readFileSync(resolve(repository, path));
}

function readText(path) {
    return readBytes(path).toString('utf8');
}

const manifest = JSON.parse(readText('docs/publication-manifest.json'));
const vendorLock = JSON.parse(readText('docs/vendor-lock.json'));
const knownLimitationsPath = 'docs/known-limitations.md';
const geodataManifestPath = 'src/main/resources/static/data/geodata/manifest.json';
const target = inspectedRef || 'HEAD';
const roots = git('rev-list', '--max-parents=0', target).split(/\r?\n/u).filter(Boolean);
if (roots.length !== 1 || roots[0] !== manifest.approvedHistoryRoot) {
    fail('검사 대상이 승인된 단일 공개 루트에서 시작하지 않습니다.');
}

for (const path of files) {
    if (isForbiddenPath(path)) {
        fail(`공개 금지 경로가 포함됐습니다: ${path}`);
    }
    const size = inspectedRef ? readBytes(path).length : statSync(resolve(repository, path)).size;
    if (size > 10 * 1024 * 1024) fail(`10 MiB를 넘는 파일입니다: ${path}`);
}

const sourceExtensions = new Set([
    '.css', '.gradle', '.html', '.java', '.js', '.json', '.jsp', '.md', '.mjs', '.ps1', '.svg', '.txt', '.xml', '.yml', '.yaml'
]);
const sourceFiles = files.filter((path) => sourceExtensions.has(extname(path).toLowerCase()));
const runtimeFiles = sourceFiles.filter((path) =>
    /^(?:src\/main|cloudflare\/src|cloudflare\/build\.mjs)/u.test(path)
    && !/\/vendor\//u.test(path));
for (const path of runtimeFiles) {
    for (const runtime of findForbiddenChartRuntimes(readText(path))) {
        fail(`${runtime} 런타임 흔적이 있습니다: ${path}`);
    }
}

for (const path of sourceFiles.filter((path) => !path.startsWith('docs/'))) {
    const indicators = findSecretIndicators(readText(path));
    if (indicators.length > 0) {
        fail(`하드코딩된 Secret으로 보이는 패턴이 있습니다 (${indicators.join(', ')}): ${path}`);
    }
}

const localDenylistPath = resolve(repository, '.publication-denylist.local');
if (existsSync(localDenylistPath)) {
    const deniedTerms = parseDenylist(readFileSync(localDenylistPath, 'utf8'));
    for (const path of sourceFiles) {
        if (containsDeniedTerm(readText(path), deniedTerms)) {
            fail(`로컬 비공개 식별자 검사에 실패했습니다: ${path}`);
        }
    }
} else {
    warn('선택적 로컬 식별자 목록이 없습니다: .publication-denylist.local');
}

const requiredNotices = [
    'src/main/resources/static/vendor/jquery.LICENSE.txt',
    'src/main/resources/static/vendor/three.LICENSE.txt',
    'src/main/resources/static/vendor/openlayers.LICENSE.md',
    'src/main/resources/static/vendor/proj4.LICENSE.md',
    'src/main/resources/static/vendor/hls.LICENSE.txt',
    'src/main/resources/static/vendor/cambecc-earth.LICENSE.md',
    'THIRD_PARTY_NOTICES.md'
];
for (const path of requiredNotices) {
    if (!hasFile(path)) fail(`제3자 고지 파일이 없습니다: ${path}`);
}

const requiredGovernance = [
    '.editorconfig',
    '.githooks/pre-push',
    '.github/dependabot.yml',
    '.github/pull_request_template.md',
    '.publication-denylist.example',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/known-limitations.md',
    'docs/publication-denylist.md',
    'docs/publication-manifest.json',
    'docs/publication-readiness.md',
    'docs/reimplementation-backlog.md',
    'docs/reimplementation-log.md',
    'docs/release-checklist.md',
    'docs/vendor-lock.json',
    'scripts/publication-rules.mjs',
    'scripts/publication-rules.test.mjs'
];
for (const path of requiredGovernance) {
    if (!hasFile(path)) fail(`공개 관리 파일이 없습니다: ${path}`);
}

if (hasFile(knownLimitationsPath) && hasFile(geodataManifestPath)) {
    const knownLimitations = readText(knownLimitationsPath);
    const geodataManifest = JSON.parse(readText(geodataManifestPath));
    const unavailable = Array.isArray(geodataManifest.unavailable)
        ? geodataManifest.unavailable
        : [];
    if (!unavailable.some((entry) => entry?.key === 'koreaAdmin2')) {
        fail('지오데이터 manifest가 koreaAdmin2 제한을 명시하지 않습니다.');
    }
    if (!knownLimitations.includes('koreaAdmin2')) {
        fail('알려진 제한 사항 문서가 koreaAdmin2 기능 공백을 설명하지 않습니다.');
    }
    for (const blocker of manifest.releaseBlockers) {
        if (!knownLimitations.includes(blocker)) {
            fail(`알려진 제한 사항 문서에 공개 차단 항목이 없습니다: ${blocker}`);
        }
    }
}

for (const asset of manifest.assets) {
    if (!hasFile(asset.path)) {
        fail(`자산 목록의 파일이 없습니다: ${asset.path}`);
        continue;
    }
    const bytes = readBytes(asset.path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== asset.bytes || digest !== asset.sha256) {
        fail(`자산 목록의 크기 또는 SHA-256이 다릅니다: ${asset.path}`);
    }
}

for (const artifact of vendorLock.artifacts) {
    if (!hasFile(artifact.path)) {
        fail(`vendor lock의 파일이 없습니다: ${artifact.path}`);
        continue;
    }
    const bytes = readBytes(artifact.path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== artifact.bytes || digest !== artifact.sha256) {
        fail(`vendor lock의 크기 또는 SHA-256이 다릅니다: ${artifact.path}`);
    }
}

if (releaseMode) {
    if (manifest.releaseStatus !== 'ready' || manifest.releaseBlockers.length > 0) {
        fail('publication manifest에 해결되지 않은 공개 차단 항목이 있습니다.');
    }
    if (!hasFile('LICENSE')) {
        fail('프로젝트 자체 코드의 루트 LICENSE가 없습니다.');
    }
} else if (manifest.releaseBlockers.length > 0) {
    warn(`공개 차단 항목 ${manifest.releaseBlockers.length}개가 남았습니다. --release는 실패합니다.`);
}

for (const message of warnings) console.warn(`WARN  ${message}`);
for (const message of failures) console.error(`FAIL  ${message}`);
if (failures.length > 0) {
    console.error(`\n공개 감사 실패: ${failures.length}건`);
    process.exit(1);
}
const targetLabel = inspectedRef ? `, ref ${git('rev-parse', '--short=12', inspectedRef)}` : '';
console.log(
    `공개 감사 통과 (${releaseMode ? 'release' : 'development'} mode, `
    + `${files.length} files${targetLabel})`
);
