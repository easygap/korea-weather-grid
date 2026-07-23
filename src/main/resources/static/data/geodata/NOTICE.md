# Map data notice

- `east-asia-land.geojson` and `korea-admin1.geojson` are deterministically processed from Natural Earth 5.1.1. Natural Earth vector data is in the public domain. Source and processing details are embedded in each file.
- The application computes one representative search point inside each province polygon at runtime. No separate station inventory is bundled.
- Province geometry is for cartographic context, not legal, cadastral or routing decisions.
- A municipality (admin-2) boundary is not bundled because no verified, current and redistributable source has been selected.

Natural Earth terms: https://www.naturalearthdata.com/about/terms-of-use/

## Provenance

- Land source archive: `https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip`, SHA-256 `e547d749445eaa0964aba76738090ec88f5e63c4585122170f98c67a7ea922dc`.
- Province source archive: `https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip`, SHA-256 `efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05`.
- `east-asia-land.geojson`: clip to `[112,25,145,50]`, apply Turf high-quality simplification with tolerance `0.015°`, then round coordinates to `0.0001°`.
- `korea-admin1.geojson`: select `adm0_a3=KOR`, apply Turf high-quality simplification with tolerance `0.0015°`, keep only map-facing identifiers/names, normalize the current 17 Korean display labels, then round coordinates to `0.0001°`. It is not a legal boundary dataset.
- `manifest.json` records the deployed byte length and SHA-256 of every generated asset.

## Rebuild

```bash
npm ci --prefix tools/geodata
npm run build --prefix tools/geodata
npm run check --prefix tools/geodata
```

`tools/geodata/sources.json` pins archive URLs, byte sizes and SHA-256 values. The builder refuses
unexpected source bytes, uses fixed processing constants, writes stable JSON, and verifies byte-for-byte
output in `--check` mode.
