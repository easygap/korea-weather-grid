# Third-party notices

The application vendors the following browser runtimes so that production does not depend on
third-party CDNs. Each distribution keeps its upstream license alongside the deployed file.

| Component | Version | Purpose | License | Vendored files | Upstream |
|---|---:|---|---|---|---|
| jQuery | 4.0.0 | DOM and event compatibility | MIT | `static/js/jquery-4.0.0.min.js`, `static/vendor/jquery.LICENSE.txt` | <https://github.com/jquery/jquery/tree/4.0.0> |
| OpenLayers | 10.9.0 | Web map rendering | BSD-2-Clause | `static/vendor/openlayers-10.9.0.*`, `static/vendor/openlayers.LICENSE.md` | <https://github.com/openlayers/openlayers/tree/v10.9.0> |
| Proj4js | 2.20.9 | Coordinate transformations | MIT | `static/vendor/proj4-2.20.9.min.js`, `static/vendor/proj4.LICENSE.md` | <https://github.com/proj4js/proj4js/tree/2.20.9> |
| hls.js | 1.6.16 light build | HLS playback fallback | Apache-2.0 | `static/vendor/hls.light.min.js`, `static/vendor/hls.LICENSE.txt` | <https://github.com/video-dev/hls.js/tree/v1.6.16> |
| three.js | r185 | Optional 3D terrain and globe | MIT | `static/js/three/**`, `static/vendor/three.LICENSE.txt` | <https://github.com/mrdoob/three.js/tree/r185> |
| earth | source approach credited, no vendored runtime | Historical inspiration for the particle-flow rendering approach | MIT | `static/js/windy.js`, `static/vendor/cambecc-earth.LICENSE.md` | <https://github.com/cambecc/earth> |
| IBM Plex Mono | Google Fonts v20 Latin subset | Readout typeface for values, timestamps, and coordinates | OFL-1.1 | `static/font/plex-mono-{400,500,600}.woff2`, `static/font/OFL.txt` | <https://github.com/IBM/plex> |

Only the Latin subset of IBM Plex Mono is vendored (about 45 KB total for three weights). Hangul is
rendered by the platform UI stack declared in `--font-ui`; no Korean webfont is downloaded.

## Charts

Station charts do not load Highcharts, Highcharts Windbarb, Chart.js, or another chart runtime.
`static/js/station-charts.js` is a first-party SVG renderer. Wind direction glyphs are ordinary SVG
paths created by that renderer; they are not the Highcharts Windbarb module.

## Map and public data

- VWorld Base tiles and PBF vector road tiles are requested at runtime from the official
  `api.vworld.kr` access path. The map UI displays VWorld attribution. VWorld data is not bundled
  in this repository. Use is subject to the
  [VWorld API policy](https://www.vworld.kr/v4po_prcint_a001.do) and
  [copyright policy](https://www.vworld.kr/v4po_prcint_a006.do).
- OpenStreetMap tiles are requested from the configured tile service and retain the required
  OpenStreetMap attribution in the map UI. OpenStreetMap data is not bundled in this repository.
- Natural Earth 5.1.1 input data is public domain. The processed files and their current provenance
  limitations are documented in `static/data/geodata/NOTICE.md`.
- Weather, air-quality, and traffic data are fetched from the public APIs named in `README.md`.
  API responses and credentials are not part of the source distribution.

Java, Gradle, Node.js, and test-only transitive dependencies remain governed by their own upstream
licenses. Their exact resolved versions are recorded by Gradle dependency metadata and the committed
`package-lock.json` files.
