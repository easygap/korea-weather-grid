import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const dataDir = path.join(root, 'src', 'main', 'resources', 'static', 'data', 'geodata');
const require = createRequire(import.meta.url);
const loader = require(path.join(root, 'src', 'main', 'resources', 'static', 'js', 'geodata-loader.js'));

async function readAsset(file) {
    return JSON.parse(await readFile(path.join(dataDir, file), 'utf8'));
}

test('bundled geodata assets satisfy their runtime schemas', async () => {
    const land = loader.validate('eastAsiaLand', await readAsset('east-asia-land.geojson'));
    const admin1 = loader.validate('koreaAdmin1', await readAsset('korea-admin1.geojson'));

    assert.equal(land.features.length, 9);
    assert.equal(admin1.features.length, 17);
    assert.equal(new Set(admin1.features.map((feature) => feature.properties.regionId)).size, 17);
    assert.deepEqual(Object.keys(loader.ASSETS).sort(), ['eastAsiaLand', 'koreaAdmin1']);
});

test('manifest sizes and hashes match deployed geodata assets', async () => {
    const manifest = await readAsset('manifest.json');
    assert.equal(manifest.schema, 'weather-grid.geodata-manifest/v1');
    assert.ok(manifest.unavailable.some((item) => item.key === 'koreaAdmin2'));

    for (const asset of manifest.assets) {
        const file = path.basename(asset.path);
        const contents = await readFile(path.join(dataDir, file));
        assert.equal(contents.byteLength, asset.bytes, file);
        assert.equal(createHash('sha256').update(contents).digest('hex'), asset.sha256, file);
    }
});

test('client caches concurrent requests and retries a rejected request', async () => {
    const land = await readAsset('east-asia-land.geojson');
    let calls = 0;
    const client = loader.createClient({
        fetch: async () => {
            calls += 1;
            if (calls === 1) throw new Error('temporary failure');
            return { ok: true, status: 200, json: async () => land };
        }
    });

    await assert.rejects(client.load('eastAsiaLand'), /temporary failure/);
    const [first, second] = await Promise.all([
        client.load('eastAsiaLand'),
        client.load('eastAsiaLand')
    ]);
    assert.equal(calls, 2);
    assert.strictEqual(first, second);
    assert.strictEqual(client.peek('eastAsiaLand'), first);
});

test('validator rejects unexpected schemas and unsafe coordinates', async () => {
    const land = structuredClone(await readAsset('east-asia-land.geojson'));
    land.schema = 'unknown/v1';
    assert.throws(() => loader.validate('eastAsiaLand', land), /unexpected schema/);

    const unsafeLand = structuredClone(await readAsset('east-asia-land.geojson'));
    const geometry = unsafeLand.features[0].geometry;
    const position = geometry.type === 'Polygon'
        ? geometry.coordinates[0][0]
        : geometry.coordinates[0][0][0];
    position[0] = 999;
    assert.throws(() => loader.validate('eastAsiaLand', unsafeLand), /longitude is out of range/);
});
