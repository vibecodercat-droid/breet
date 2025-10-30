# Breet – Break + Breathe

크롬 확장 프로그램(MV3) – 잠깐의 호흡으로 리셋하는 AI 브레이크 코치 (MVP)

## 개발 빠른 시작

1) 크롬에서 개발자 모드 활성화 → `chrome://extensions`
2) "Load unpacked" → 이 폴더 선택(`/Users/kimsomin/breet`)
3) 팝업 열어 타이머 시작/정지 동작 확인

## 구조

- `manifest.json` – MV3 설정, 권한, CSP
- `background/` – 타이머/알람/알림 서비스 워커
- `popup/` – 대시보드(타이머/할 일/링크)
- `pages/` – 온보딩/통계/설정 페이지
- `content/` – 브레이크 오버레이
- `lib/` – 스토리지/통계/규칙/유틸

CDN 기반 Tailwind CSS를 사용하지만 MV3 제약으로 외부 스크립트는 불허됩니다. Chart.js는 로컬 번들로 추후 추가합니다.
