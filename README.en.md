<h1 align="center">BORA · Weather in South Korea</h1>

<p align="center">
  <strong>Explore the weather on a map.</strong><br>
  Check wind, temperature and rain, then tap a location for its 48-hour forecast.
</p>

<p align="center">
  <a href="README.md" lang="ko">한국어</a> · <strong>English</strong> · <a href="README.ja.md" lang="ja">日本語</a> · <a href="README.zh-CN.md" lang="zh-CN">简体中文</a>
</p>

<p align="center"><a href="https://bora-weather.dlwnstndlwld.workers.dev"><strong>Open the weather map ↗</strong></a></p>

![BORA showing wind across South Korea, location search and forecast controls](docs/media/hero-wind.webp)

See where winds are strongest, how temperatures will change overnight, and where rain is expected. BORA brings together forecasts from the Korea Meteorological Administration, air-quality readings and road cameras.

The map's controls are currently in Korean. This guide includes the Korean menu labels to help you find your way. All times are Korea Standard Time (KST, UTC+9).

## Follow the wind

Moving lines show wind direction; the map's colors show wind speed. Darker shades mean stronger winds. Check the color key or tap a location for the actual speed in metres per second.

![Wind direction and speed on the live map](docs/media/wind-streamline.gif)

## See what changes later

Move the time control at the bottom to compare forecasts for the same area. Press play to step through them automatically.

![Temperature forecasts at different times](docs/media/timeline-play.gif)

| What you want to check | Menu label |
| --- | --- |
| Wind direction and speed | 풍향·풍속 |
| Temperature | 기온 |
| Rain and snow | 강수·적설 |
| Solar irradiance | 일사강도 |
| Humidity, sky conditions and wave height | 다른 기상요소 보기 |
| Weather alerts, typhoon tracks and recent lightning | 위험기상 |

<table>
  <tr>
    <td width="50%"><img src="docs/media/temperature.webp" alt="Temperature across South Korea"><p><strong>Temperature</strong> · Compare warmer and colder areas.</p></td>
    <td width="50%"><img src="docs/media/solar.webp" alt="Solar irradiance across South Korea"><p><strong>Solar irradiance</strong> · See how incoming sunlight varies by place and time.</p></td>
  </tr>
</table>

## Get a forecast for your destination

Search for a place or tap the map to open its forecast for the next 48 hours. The chart shows the overall trend, with temperature, chance of rain or snow, humidity and wind in the hourly cards below. You can also open a table of the forecast values.

![A 48-hour wind chart and hourly forecast for Busan](docs/media/station-timeseries.webp)

## Take it with you

On your phone, search at the top and change the weather layer or forecast time at the bottom. Sharing, 3D views and light/dark mode are in the settings at the top right.

<p align="center">
  <img src="docs/media/mobile-map.webp" width="320" alt="BORA on a phone">
  &nbsp;&nbsp;
  <img src="docs/media/mobile-sheet.webp" width="320" alt="Mobile display settings">
</p>

## Check the air and the roads

Choose **대기질** for AirKorea monitoring stations. Tap a station to see its PM10 and PM2.5 readings, rating and observation time.

Air quality uses the **latest available observations**. Changing the forecast time changes the wind layer, not the particulate readings.

![PM2.5 monitoring stations and observation details](docs/media/air-quality.webp)

Choose **교통**, then zoom in to find road cameras. Select a camera and press play to connect. Some streams may be unavailable when the provider has connection problems.

## A few more ways to explore

- **Expand the color key** to see all intervals and the minimum, average and maximum values.
- **Turn on contour lines** to connect places with the same forecast value.
- **Measure distance** between map points, including routes made up of several straight segments.
- **Switch to map-only view** to hide the controls.
- **Share a link** with your current location, weather layer and forecast time.
- **Try 3D** to display weather values as height or on a globe. The raised surface represents the weather data, not terrain elevation.

<table>
  <tr>
    <td width="50%"><img src="docs/media/isoline-dock.webp" alt="Lines connecting places with the same temperature"><p><strong>Temperature contours</strong></p></td>
    <td width="50%"><img src="docs/media/measure.webp" alt="Measuring straight-line distance between Seoul and Busan"><p><strong>Distance measurement</strong></p></td>
  </tr>
  <tr>
    <td><img src="docs/media/terrain-3d.webp" alt="Stronger winds shown as a taller surface"><p><strong>Weather values in 3D</strong></p></td>
    <td><img src="docs/media/dark-theme.webp" alt="Temperature map in dark mode"><p><strong>Dark mode</strong></p></td>
  </tr>
</table>

Keyboard shortcuts: `/` opens search, `F` toggles map-only view, and `Esc` closes the current panel.

## Where the data comes from

Forecasts, weather alerts, typhoons and lightning come from the **Korea Meteorological Administration**. Air-quality readings come from **AirKorea**, and road cameras from Korea's **National Transport Information Center (ITS)**. Observations and video feeds can be delayed or temporarily unavailable. Check [official KMA announcements](https://www.weather.go.kr/) when making decisions about severe weather.

Screenshots were taken on September 22, 2026. Animated wind lines illustrate direction; their on-screen speed is not a measure of actual wind speed.

[Data sources and third-party licenses](THIRD_PARTY_NOTICES.md) · [Known limitations](docs/known-limitations.md) · [Run it yourself](docs/getting-started.md) · [Report a problem](https://github.com/easygap/korea-weather-grid/issues)

The linked technical documentation is in Korean. The project code does not yet have an open-source license. Libraries, fonts and datasets remain subject to their respective licenses.
