import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import bboxClip from '@turf/bbox-clip';
import simplify from '@turf/simplify';
import AdmZip from 'adm-zip';
import * as shapefile from 'shapefile';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(toolDirectory, '..', '..');
const cacheDirectory = resolve(repository, 'build', 'geodata-sources');
const outputDirectory = resolve(repository, 'src', 'main', 'resources', 'static', 'data', 'geodata');
const checkOnly = process.argv.includes('--check');
const sources = JSON.parse(readFileSync(join(toolDirectory, 'sources.json'), 'utf8'));
const BOUNDS = [112, 25, 145, 50];
const COORDINATE_DIGITS = 4;
const LAND_TOLERANCE = 0.015;
const ADMIN_TOLERANCE = 0.0015;

const REGION_NAMES = Object.freeze({
    'KR-11': ['서울특별시', 'Seoul'],
    'KR-26': ['부산광역시', 'Busan'],
    'KR-27': ['대구광역시', 'Daegu'],
    'KR-28': ['인천광역시', 'Incheon'],
    'KR-29': ['광주광역시', 'Gwangju'],
    'KR-30': ['대전광역시', 'Daejeon'],
    'KR-31': ['울산광역시', 'Ulsan'],
    'KR-41': ['경기도', 'Gyeonggi'],
    'KR-42': ['강원특별자치도', 'Gangwon'],
    'KR-43': ['충청북도', 'North Chungcheong'],
    'KR-44': ['충청남도', 'South Chungcheong'],
    'KR-45': ['전북특별자치도', 'North Jeolla'],
    'KR-46': ['전라남도', 'South Jeolla'],
    'KR-47': ['경상북도', 'North Gyeongsang'],
    'KR-48': ['경상남도', 'South Gyeongsang'],
    'KR-49': ['제주특별자치도', 'Jeju'],
    'KR-50': ['세종특별자치시', 'Sejong']
});

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

async function verifiedArchive(key) {
    const source = sources.archives[key];
    const archivePath = join(cacheDirectory, basename(new URL(source.url).pathname));
    mkdirSync(cacheDirectory, { recursive: true });
    if (!existsSync(archivePath)) {
        const response = await fetch(source.url);
        if (!response.ok) throw new Error(`Natural Earth download failed (${response.status}): ${source.url}`);
        writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
    }
    const bytes = readFileSync(archivePath);
    if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) {
        throw new Error(`Natural Earth archive integrity mismatch: ${key}`);
    }
    return { ...source, archivePath };
}

async function readArchive(key) {
    const source = await verifiedArchive(key);
    const extracted = join(cacheDirectory, `extracted-${key}`);
    rmSync(extracted, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    new AdmZip(source.archivePath).extractAllTo(extracted, true);
    return shapefile.read(join(extracted, `${source.stem}.shp`), join(extracted, `${source.stem}.dbf`));
}

function cleanDbfText(value) {
    return String(value ?? '').replaceAll('\0', '').trim();
}

function roundedPoint(point) {
    return point.map((value) => Number(value.toFixed(COORDINATE_DIGITS)));
}

function samePoint(left, right) {
    return left[0] === right[0] && left[1] === right[1];
}

function normalizedRing(ring) {
    const points = [];
    for (const sourcePoint of ring) {
        const point = roundedPoint(sourcePoint);
        if (points.length === 0 || !samePoint(points.at(-1), point)) points.push(point);
    }
    if (points.length > 0 && !samePoint(points[0], points.at(-1))) points.push([...points[0]]);
    return points.length >= 4 ? points : null;
}

function normalizedPolygon(polygon) {
    const rings = polygon.map(normalizedRing).filter(Boolean);
    return rings.length > 0 ? rings : null;
}

function normalizedGeometry(geometry) {
    if (geometry.type === 'Polygon') {
        const coordinates = normalizedPolygon(geometry.coordinates);
        return coordinates ? { type: 'Polygon', coordinates } : null;
    }
    if (geometry.type === 'MultiPolygon') {
        const coordinates = geometry.coordinates.map(normalizedPolygon).filter(Boolean);
        return coordinates.length > 0 ? { type: 'MultiPolygon', coordinates } : null;
    }
    throw new Error(`Unsupported geometry: ${geometry.type}`);
}

function normalizedFeature(feature, properties) {
    const geometry = normalizedGeometry(feature.geometry);
    if (!geometry) return null;
    return {
        type: 'Feature',
        properties,
        geometry
    };
}

function assertCoordinate(point, label) {
    if (!Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite)) {
        throw new Error(`Invalid coordinate in ${label}`);
    }
    const [longitude, latitude] = point;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        throw new Error(`Out-of-range coordinate in ${label}: ${longitude},${latitude}`);
    }
}

function assertRing(ring, label) {
    if (!Array.isArray(ring) || ring.length < 4) throw new Error(`Invalid ring in ${label}`);
    ring.forEach((point) => assertCoordinate(point, label));
    if (!samePoint(ring[0], ring.at(-1))) throw new Error(`Open ring in ${label}`);
}

function assertFeatureCollection(collection, expectedCount) {
    if (collection.type !== 'FeatureCollection' || collection.features.length !== expectedCount) {
        throw new Error(`Expected ${expectedCount} features in ${collection.id}, received ${collection.features.length}`);
    }
    collection.features.forEach((feature, featureIndex) => {
        const label = `${collection.id} feature ${featureIndex}`;
        const polygons = feature.geometry.type === 'Polygon'
            ? [feature.geometry.coordinates]
            : feature.geometry.type === 'MultiPolygon'
                ? feature.geometry.coordinates
                : null;
        if (!polygons?.length) throw new Error(`Invalid polygon geometry in ${label}`);
        polygons.forEach((polygon, polygonIndex) => {
            if (!polygon.length) throw new Error(`Polygon has no rings in ${label}`);
            polygon.forEach((ring, ringIndex) => assertRing(ring, `${label} polygon ${polygonIndex} ring ${ringIndex}`));
        });
    });
}

async function buildLand() {
    const source = await readArchive('land');
    const features = source.features.map((feature) => bboxClip(feature, BOUNDS))
        .filter((feature) => feature.geometry.coordinates.length > 0)
        .map((feature) => simplify(feature, {
            tolerance: LAND_TOLERANCE,
            highQuality: true,
            mutate: false
        }))
        .map((feature) => normalizedFeature(feature, {}))
        .filter(Boolean);
    return {
        type: 'FeatureCollection',
        schema: 'weather-grid.geojson/v1',
        id: 'east-asia-land',
        metadata: {
            source: 'Natural Earth 1:10m Land',
            sourceVersion: '5.1.1',
            sourceArchiveSha256: sources.archives.land.sha256,
            license: 'Public domain',
            generatedAt: '2026-07-22',
            processing: `bbox ${JSON.stringify(BOUNDS)}, turf simplify tolerance ${LAND_TOLERANCE}, coordinate precision 0.0001°`
        },
        bbox: BOUNDS,
        features
    };
}

async function buildAdmin1() {
    const source = await readArchive('admin1');
    const features = source.features.filter((feature) => feature.properties.adm0_a3 === 'KOR')
        .map((feature) => {
            const regionId = cleanDbfText(feature.properties.iso_3166_2);
            const names = REGION_NAMES[regionId];
            if (!names) throw new Error(`Unmapped Korean admin-1 region: ${regionId}`);
            const reduced = simplify(feature, {
                tolerance: ADMIN_TOLERANCE,
                highQuality: true,
                mutate: false
            });
            const normalized = normalizedFeature(reduced, {
                regionId,
                nameKo: names[0],
                nameEn: names[1],
                sourceId: cleanDbfText(feature.properties.adm1_code)
            });
            if (!normalized) throw new Error(`Empty Korean admin-1 geometry: ${regionId}`);
            return normalized;
        })
        .sort((left, right) => left.properties.regionId.localeCompare(right.properties.regionId));
    if (features.length !== Object.keys(REGION_NAMES).length) {
        throw new Error(`Expected 17 Korean admin-1 features, received ${features.length}`);
    }
    return {
        type: 'FeatureCollection',
        schema: 'weather-grid.geojson/v1',
        id: 'korea-admin1',
        metadata: {
            source: 'Natural Earth 1:10m Admin 1 – States, Provinces',
            sourceVersion: '5.1.1',
            sourceArchiveSha256: sources.archives.admin1.sha256,
            license: 'Public domain',
            generatedAt: '2026-07-22',
            processing: `select adm0_a3=KOR, turf simplify tolerance ${ADMIN_TOLERANCE}, coordinate precision 0.0001°`,
            accuracy: 'Cartographic context only. Labels reflect current province names; geometry is not a legal or cadastral boundary.'
        },
        features
    };
}

function encodedJson(value) {
    return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

function verifyOrWrite(path, bytes) {
    if (checkOnly) {
        if (!existsSync(path) || !readFileSync(path).equals(bytes)) {
            throw new Error(`Generated geodata differs: ${path}`);
        }
        return;
    }
    writeFileSync(path, bytes);
}

const land = await buildLand();
const admin = await buildAdmin1();
assertFeatureCollection(land, 9);
assertFeatureCollection(admin, 17);
const landBytes = encodedJson(land);
const adminBytes = encodedJson(admin);
const outputs = [
    { key: 'eastAsiaLand', name: 'east-asia-land.geojson', count: land.features.length, bytes: landBytes },
    { key: 'koreaAdmin1', name: 'korea-admin1.geojson', count: admin.features.length, bytes: adminBytes }
];
for (const output of outputs) {
    verifyOrWrite(join(outputDirectory, output.name), output.bytes);
}

const manifest = {
    schema: 'weather-grid.geodata-manifest/v1',
    generatedAt: '2026-07-22',
    assets: outputs.map((output) => ({
        key: output.key,
        path: `/static/data/geodata/${output.name}`,
        schema: 'weather-grid.geojson/v1',
        loading: 'initial',
        itemCount: output.count,
        bytes: output.bytes.length,
        sha256: sha256(output.bytes)
    })),
    unavailable: [{
        key: 'koreaAdmin2',
        reason: 'No current, verified and redistributable nationwide municipality boundary source has been selected.'
    }]
};
verifyOrWrite(join(outputDirectory, 'manifest.json'), encodedJson(manifest));

console.log(`${checkOnly ? 'verified' : 'generated'} ${outputs.map((output) =>
    `${output.name} (${output.bytes.length} bytes, ${sha256(output.bytes)})`).join(', ')}`);
