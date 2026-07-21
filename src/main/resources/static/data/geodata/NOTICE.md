# Map data notice

- `east-asia-land.geojson` and `korea-admin1.geojson` are processed from Natural Earth 5.1.1. Natural Earth vector data is in the public domain. Source and processing details are embedded in each file.
- The application computes one representative search point inside each province polygon at runtime. No separate station inventory is bundled.
- Province geometry is for cartographic context, not legal, cadastral or routing decisions.
- A municipality (admin-2) boundary is not bundled because no verified, current and redistributable source has been selected.

Natural Earth terms: https://www.naturalearthdata.com/about/terms-of-use/

## Provenance

- Land source archive: `https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip`
- Province source archive: `https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip`
- `east-asia-land.geojson`: clip to `[112,25,145,50]`, simplify to `12%` with shape preservation, then round coordinates to `0.0001°`.
- `korea-admin1.geojson`: select the 17 Korean admin-1 features, keep only map-facing identifiers/names, and normalize current Korean display labels. It is not a legal boundary dataset.
- `manifest.json` records the deployed byte length and SHA-256 of every asset. The original one-off conversion command was not retained, so the manifest is the byte-level reference; do not regenerate these files without a documented, reproducible source pipeline.
