<h1 align="center">BORA 기상지도</h1>

<p align="center">
  <strong>전국 날씨는 지도로, 우리 동네 예보는 시간대별로.</strong><br>
  기상청 예보를 바탕으로 바람·기온·강수량을 살펴보는 웹 서비스입니다.
</p>

<p align="center">
  <a href="https://bora-weather.dlwnstndlwld.workers.dev"><strong>서비스 열기 ↗</strong></a>
  &nbsp;·&nbsp; <a href="#이렇게-사용하세요">사용 방법</a>
  &nbsp;·&nbsp; <a href="docs/getting-started.md">직접 실행하기</a>
</p>

![BORA 첫 화면. 전국 풍속 분포, 바람선, 지역 검색과 하단 예보 시간축](docs/media/hero-wind.webp)

화면은 **2026년 9월 22일, 이 저장소의 소스와 실제 운영 API로 실행해 캡처**했습니다. 자료 시각과 값은 조회할 때마다 달라집니다.

## 바람의 방향과 세기를 한눈에

색이 짙을수록 바람이 강한 곳입니다. 움직이는 바람선으로 방향을 보고, 아래 시간축으로 앞으로 48시간의 변화를 확인할 수 있습니다. 발표시각과 예보시각을 따로 표시해 어떤 자료를 보고 있는지도 알 수 있습니다.

![실제 화면에서 움직이는 바람선](docs/media/wind-streamline.gif)

바람선의 재생 속도는 시각화용입니다. 실제 풍속은 `m/s` 단위의 범례와 지점별 수치로 확인하세요.

## 오늘 밤, 내일 아침은 어떨까

시간축을 옮기면 같은 지역의 예보가 바뀝니다. 재생 버튼으로 이어서 보거나, 한 시간씩 앞뒤로 이동할 수 있습니다.

![시간축을 이동하며 비교하는 기온 예보](docs/media/timeline-play.gif)

| 기상요소 | 확인할 수 있는 정보 |
| --- | --- |
| 풍향·풍속 | 지상 10 m 바람의 방향과 세기 |
| 기온 | 격자별 기온과 같은 기온을 잇는 등온선 |
| 강수·적설 | 1시간 강수량, 강수형태, 1시간 신적설 |
| 일사강도 | 지면에 도달하는 태양 복사량, W/㎡ |
| 그 밖의 요소 | 상대습도, 하늘상태, 파고 |
| 위험기상 | 태풍 경로, 최근 낙뢰, 발효 중인 기상특보 |

<table>
  <tr>
    <td width="50%"><img src="docs/media/temperature.webp" alt="전국 기온 분포"><p><strong>기온</strong> · 지역별 차이를 색으로 비교합니다.</p></td>
    <td width="50%"><img src="docs/media/solar.webp" alt="전국 일사강도 분포"><p><strong>일사강도</strong> · 자료의 모델 초기시각도 함께 확인합니다.</p></td>
  </tr>
</table>

## 궁금한 지역을 누르면 48시간 예보

지역명을 검색하거나 지도를 누르면 그 지점의 예보가 열립니다. 차트에서 전체 흐름을 보고, 아래에서 시간별 기온·강수확률·습도·바람을 확인하세요. 차트의 원래 값은 수치표로도 볼 수 있습니다.

![부산광역시의 48시간 풍향·풍속 차트와 시간대별 상세예보](docs/media/station-timeseries.webp)

## 휴대폰에서는 자주 쓰는 기능을 아래에

화면 아래에서 기상요소와 시간을 바꾸고, 위에서 지역을 검색합니다. 세부 설정·공유·3D·화면 테마는 오른쪽 위 설정 버튼에 모았습니다.

<p align="center">
  <img src="docs/media/mobile-map.webp" width="32%" alt="휴대폰에서 보는 기상지도와 하단 시간·자료 선택">
  &nbsp;&nbsp;
  <img src="docs/media/mobile-sheet.webp" width="32%" alt="휴대폰 설정 창. 공유와 화면 테마, 기상요소 선택">
</p>

## 미세먼지와 도로 상황도 함께

**대기질**에서는 에어코리아 측정소의 PM10·PM2.5 농도와 등급, 관측시각을 확인합니다. 바람선도 함께 볼 수 있지만, 미세먼지는 최신 관측자료이고 하단 시간축은 바람 예보에만 적용됩니다. 이 화면이 오염물질의 이동 경로를 예측하는 것은 아닙니다.

![에어코리아 측정소 위치, PM2.5 등급과 관측시각을 확인하는 화면](docs/media/air-quality.webp)

**교통**에서는 지도를 확대한 범위의 ITS CCTV를 조회합니다. 카메라를 고른 뒤 재생을 눌러야 영상에 연결합니다. 외부 자료를 불러오지 못하면 지도에 이유와 재시도 버튼을 표시합니다.

## 필요한 만큼 바꿔 보는 지도

- **범례**: 작은 색상표를 누르면 구간별 분포와 최저·평균·최고값이 펼쳐집니다.
- **등치선**: 색상 대신 같은 값을 잇는 선으로 볼 수 있습니다.
- **거리 측정**: 여러 지점을 연결해 지도상 직선거리의 합계를 구합니다.
- **지도만 보기**: 조작 패널을 접고 지도를 넓게 봅니다.
- **공유**: 위치·확대 수준·기상요소·예보시각이 담긴 링크를 복사합니다.
- **3D**: 기상값을 높이로 표현하거나 지구본에 올려 봅니다. 실제 지형의 높이를 보여 주는 기능은 아닙니다.

<table>
  <tr>
    <td width="50%"><img src="docs/media/isoline-dock.webp" alt="색상을 끄고 등온선으로 보는 기온"><p><strong>등치선</strong></p></td>
    <td width="50%"><img src="docs/media/measure.webp" alt="서울에서 부산까지 지도상 직선거리 측정"><p><strong>거리 측정</strong></p></td>
  </tr>
  <tr>
    <td><img src="docs/media/terrain-3d.webp" alt="풍속 값을 표면의 높이로 표현한 3D 화면"><p><strong>기상값을 높이로 보는 3D</strong></p></td>
    <td><img src="docs/media/dark-theme.webp" alt="어두운 화면에서 보는 기온 지도"><p><strong>어두운 화면</strong></p></td>
  </tr>
</table>

## 이렇게 사용하세요

1. **기상·대기질·교통** 중 보고 싶은 자료를 고릅니다.
2. 기상에서는 **풍향·풍속, 기온, 강수·적설** 등 요소를 선택합니다.
3. 아래 **시간축**으로 예보시각을 옮깁니다.
4. **지역 검색**이나 지도 클릭으로 지점별 예보를 확인합니다.
5. 배경지도·다른 기상요소·발표시각은 **설정**에서 바꿉니다.

키보드에서는 `/`로 검색, `F`로 지도만 보기, `Esc`로 열린 창을 닫을 수 있습니다. 거리 측정 중에는 `Enter`로 화면 중앙에 점을 추가하고 `Shift+Enter`로 완료합니다.

## 자료 출처

| 자료 | 제공 기관 |
| --- | --- |
| 격자 예보·태풍·낙뢰 | [기상청 API 허브](https://apihub.kma.go.kr/) |
| 지역별 상세예보·기상특보 | [공공데이터포털](https://www.data.go.kr/)의 기상청 API |
| 미세먼지 | [한국환경공단 에어코리아](https://www.airkorea.or.kr/) |
| 도로 CCTV | [국가교통정보센터 ITS](https://www.its.go.kr/opendata/) |
| 배경지도 | [브이월드](https://www.vworld.kr/), [OpenStreetMap 기여자](https://www.openstreetmap.org/copyright) |
| 해안선·행정경계 | [Natural Earth](https://www.naturalearthdata.com/) |

관측자료와 영상은 제공 기관의 통신·갱신 상태에 따라 지연되거나 빠질 수 있습니다. 기상특보와 안전에 관한 판단은 [기상청 공식 발표](https://www.weather.go.kr/)를 함께 확인하세요.

## 직접 실행하거나 살펴보기

Java 17과 저장소의 Gradle Wrapper로 실행할 수 있습니다. API 키 없이 화면을 확인하는 데모는 바람·기온·일사강도 예제 자료를 제공합니다.

- [실행 방법과 API 연결](docs/getting-started.md)
- [2026년 웹·모바일 조사와 화면 설계](docs/design-direction.md)
- [기상자료 표시와 용어 기준](docs/forecast-ui-research.md)
- [기능 제한과 운영 확인 사항](docs/known-limitations.md)
- [기여 안내](CONTRIBUTING.md) · [보안 문제 신고](SECURITY.md) · [사용한 오픈소스와 데이터](THIRD_PARTY_NOTICES.md)

이 저장소에는 아직 프로젝트 전체에 적용되는 오픈소스 라이선스가 없습니다. 제3자 라이브러리·글꼴·데이터의 이용 조건은 각 고지를 따릅니다.
