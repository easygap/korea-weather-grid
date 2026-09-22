<h1 align="center">BORA · 韩国天气地图</h1>

<p align="center">
  <strong>在地图上查看风向、气温和降雨预报。</strong><br>
  搜索城市或点击地图，还能查看未来48小时的逐时预报。
</p>

<p align="center">
  <a href="README.md" lang="ko">한국어</a> · <a href="README.en.md" lang="en">English</a> · <a href="README.ja.md" lang="ja">日本語</a> · <strong>简体中文</strong>
</p>

<p align="center"><a href="https://bora-weather.dlwnstndlwld.workers.dev"><strong>打开天气地图 ↗</strong></a></p>

![BORA主界面：韩国各地的风况、地点搜索和预报时间选择](docs/media/hero-wind.webp)

哪里风比较大？夜里会降温多少？移动地图，就能查看感兴趣地区的天气。BORA整合了韩国气象厅的预报、空气质量监测数据和道路摄像头，方便出门前一起查看。

地图界面目前使用韩语。本页同时列出韩语菜单名称，方便对照操作。所有时间均为韩国标准时间（KST，UTC+9），比北京时间快1小时。

## 看风向，也看风速

流动的线条表示风向，地图颜色表示风速。颜色越深，风越大。具体风速可通过下方的颜色标尺或点击地点后显示的数值查看，单位为米/秒。

![用流动线条和颜色查看风向、风速](docs/media/wind-streamline.gif)

## 换个时间，看看天气怎么变

调整画面下方的时间，就能比较同一地区不同时段的气温、风和降水预报。点击播放按钮，预报会按时间顺序自动切换。

![切换预报时间，比较气温变化](docs/media/timeline-play.gif)

| 想看什么 | 对应的韩语菜单 |
| --- | --- |
| 风向和风速 | 풍향·풍속 |
| 气温 | 기온 |
| 降雨和降雪 | 강수·적설 |
| 太阳辐射强度 | 일사강도 |
| 湿度、天空状况、浪高 | 다른 기상요소 보기 |
| 气象预警、台风路径、近期雷电 | 위험기상 |

<table>
  <tr>
    <td width="50%"><img src="docs/media/temperature.webp" alt="韩国各地的气温分布"><p><strong>气温</strong> · 比较不同地区的冷暖差异。</p></td>
    <td width="50%"><img src="docs/media/solar.webp" alt="韩国各地的太阳辐射强度"><p><strong>太阳辐射</strong> · 查看不同地点、时段的日照强度。</p></td>
  </tr>
</table>

## 查一查目的地的天气

搜索地点或直接点击地图，即可打开未来48小时的预报。先看图表了解变化趋势，再看下方的逐时卡片，确认气温、降水概率、湿度和风况。也可以展开数据表，逐项查看数值。

![釜山未来48小时的风况图表和逐时天气预报](docs/media/station-timeseries.webp)

## 手机上也能方便地查看

顶部用于搜索地点，底部用于切换天气类型和预报时间。地图分享、3D视图以及明暗主题，都可以在右上角的设置中找到。

<p align="center">
  <img src="docs/media/mobile-map.webp" width="320" alt="手机上的BORA天气地图">
  &nbsp;&nbsp;
  <img src="docs/media/mobile-sheet.webp" width="320" alt="手机上的显示设置">
</p>

## 空气质量和道路情况一起看

选择 **대기질**，即可查看AirKorea的监测站。点击站点后，会显示PM10、PM2.5浓度、等级和观测时间。

空气质量显示的是**最新观测值**。切换预报时间时，颗粒物浓度不会跟着变化，改变的只是叠加显示的风况预报。

![各监测站的PM2.5浓度与观测时间](docs/media/air-quality.webp)

选择 **교통**，再放大地图，即可查找附近的道路摄像头。选中摄像头并点击播放后才会连接视频。受数据提供方连接状况影响，部分画面可能暂时无法播放。

## 还有这些实用功能

- **展开颜色标尺**：查看完整分段，以及最小值、平均值和最大值。
- **显示等值线**：用线条连接预报数值相同的地点，比较区域差异。
- **测量距离**：在地图上选点，计算直线距离或多段直线的总长。
- **只看地图**：收起操作面板，扩大地图的可视范围。
- **分享地图**：链接中会保留当前位置、天气类型和预报时间。
- **3D视图**：将气象数值显示为高低起伏的表面，或放到地球仪上查看。这里的高度代表气象数值，并非真实地形或海拔。

<table>
  <tr>
    <td width="50%"><img src="docs/media/isoline-dock.webp" alt="连接气温相同地点的等温线"><p><strong>等温线</strong></p></td>
    <td width="50%"><img src="docs/media/measure.webp" alt="测量首尔至釜山的直线距离"><p><strong>距离测量</strong></p></td>
  </tr>
  <tr>
    <td><img src="docs/media/terrain-3d.webp" alt="风速越大、表面越高的3D画面"><p><strong>气象数据的3D视图</strong></p></td>
    <td><img src="docs/media/dark-theme.webp" alt="深色模式下的气温地图"><p><strong>深色模式</strong></p></td>
  </tr>
</table>

键盘快捷键：`/` 打开地点搜索，`F` 切换只看地图，`Esc` 关闭当前面板。

## 数据从哪里来？

预报、气象预警、台风和雷电数据来自**韩国气象厅**；空气质量观测值来自 **AirKorea**；道路视频来自韩国**国家交通信息中心（ITS）**。观测和视频可能延迟更新，也可能暂时无法使用。遇到恶劣天气，请同时查看[韩国气象厅的官方信息](https://www.weather.go.kr/)。

示例截图拍摄于2026年9月22日。风的动画用于展示方向，线条在屏幕上的移动速度不代表实际风速。

[数据来源与使用条款](THIRD_PARTY_NOTICES.md) · [当前限制](docs/known-limitations.md) · [自行运行](docs/getting-started.md) · [反馈问题](https://github.com/easygap/korea-weather-grid/issues)

以上技术文档目前为韩语。项目代码的开源许可证尚未确定；所用库、字体和数据分别遵循各自的许可条款。
