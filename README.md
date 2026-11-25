# Quad Desk

Quad Desk는 iPad에서 Neural DSP Quad Cortex의 프리셋과 씬을 편집하는 비공식 웹 앱입니다. Windows PC 또는 Raspberry Pi가 USB로 본체와 통신하고, iPad의 Safari는 로컬 네트워크를 통해 편집 화면을 표시합니다.

## 사용 라이브러리

| 패키지 | 버전 | 역할 |
| --- | --- | --- |
| [pyquadcortex](https://github.com/stokes-audio/pyquadcortex) | 0.40.0 | Quad Cortex와 USB로 통신해 프리셋·씬·블록을 편집하고 본체 튜너가 측정한 음정(Hz)을 수신합니다. |
| [react, react-dom](https://github.com/facebook/react) | 각각 19.3.1 | 그리드, 파라미터 편집기, Gig View를 브라우저에 렌더링합니다. |

USB 통신에서 `pyquadcortex`는 `hid`와 네이티브 HIDAPI로 장치에 접근하고, `protobuf`로 메시지를 처리합니다. HTTP 서버는 Python 표준 라이브러리의 `http.server`를 사용합니다. 프런트엔드 번들 생성 도구는 [esbuild](https://github.com/evanw/esbuild) 0.28.2입니다.
