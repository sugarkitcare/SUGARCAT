# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**케어마스터즈 (CareMasters)** — a Korean-language PWA for managing sick cat (환묘) health data: blood glucose, insulin, weight, meals, routines, blood tests, and CGM. The tagline is "수치로 관리하는 환묘 질환 케어".

Deployed on **Vercel**. No build step — `index.html` is served as a static file directly.

## Architecture

### File layout

| File | Role |
|------|------|
| `index.html` | Entire frontend (~415 KB) — all HTML, CSS, and JavaScript in one file |
| `sw.js` | Service worker; cache is intentionally disabled (always fetches fresh) |
| `manifest.json` | PWA manifest |
| `api/config.js` | Vercel serverless function — returns Supabase URL + anon key from env vars |
| `api/proxy.js` | Vercel serverless function — proxies to Anthropic API with IP-based rate limiting (20 req/hr) |

### Data flow

- **Primary storage**: `localStorage` — all records are written here first via `saveS(date)`.
- **Cloud sync**: Supabase (PostgreSQL). `saveToDB(date)` syncs daily records; `syncFromDB()` pulls on login. Auth is handled by `initSupabase()` at page load.
- **AI**: Claude API called via `/api/proxy` (never directly from the browser).
- **Config**: Browser fetches `/api/config` on startup to get Supabase credentials; they are never hardcoded in `index.html`.

### State model

A single global `state` object holds everything:
```
state = {
  cats: string[],          // cat names (max 4)
  activeCat: string,       // currently selected cat
  records: {               // keyed by catName → date (YYYY-MM-DD) → daily record
    [cat]: { [date]: { bg[], ins[], meals[], weights[], routines[], water[], urine[] } }
  },
  catProfiles: { [cat]: { diseases[], ... } }
}
```
`getRec(cat, date)` is the canonical accessor; it initialises the nested structure if missing.

### Navigation tabs

`showTab(tabId, btnEl)` controls visibility of tab sections:
- `daily` — today's records (blood glucose, insulin, weight, meals, water, routines)
- `cgm` — CGM viewer
- `graph` — charts
- `history` — past record lookup
- `bloodtest` — blood panel table + trend chart
- `food` — feed/food nutrition analysis (AI-powered)
- `ai` — freeform AI chat (`sendAI()`)

### Card system

Cards within the `daily` tab can be reordered and hidden per-cat. Order/visibility are stored in localStorage keys `cardOrder_v1_<cat>` and `cardHidden_v1_<cat>`, and also synced to Supabase via `loadCardSettingsForCat` / `saveGraphHidden`.

## Environment variables (Vercel)

| Variable | Used by |
|----------|---------|
| `SUPABASE_URL` | `api/config.js` |
| `SUPABASE_ANON_KEY` | `api/config.js` |
| `ANTHROPIC_API_KEY` | `api/proxy.js` |

## Deployment

Push to `main` → Vercel auto-deploys. No build command needed.

After any change to `index.html`, bump the service worker cache version string in `sw.js`:
```js
const CACHE_NAME = 'caremaster-v0.4.XX';  // increment XX
```
This forces all clients to reload the new version immediately.

## Admin / feedback

`ADMIN_EMAIL = 'limkit@kakao.com'` is hardcoded. The feedback modal and admin page (`openAdminPage`) are only accessible to that account via Supabase auth check.

## 절대 금지 사항

- `idx_end=-1` 방식으로 파일 끝을 찾아 str_replace 하는 것 금지 — 대량 코드 손실 발생한 전례 있음
- 코드 수정 후 반드시 문법 검증: `node --input-type=module < /tmp/check.js`
- BT_NORM_MAP 수정 시 replace 방식만 사용, 절대 끝 인덱스 방식 금지

## 버전 관리

- 모든 변경 시 BETA 버전 번호 순차 증가 (현재 v0.4.94)
- 형식: `BETA v0.4.XX` (index.html 상단 헤더)

## 주요 함수 참고

- `getRec(cat, date)` — 레코드 접근 표준 함수
- `saveS(date)` — localStorage 저장
- `saveToDB(date)` — Supabase 동기화
- `showTab(tabId)` — 탭 전환
- `applyCardOrder(cat)` — 카드 순서 적용
- `renderBTTrend()` — 혈액검사 그래프 렌더링
- `BT_NORM_REVERSE` — 혈액검사 항목 정규화 역매핑

## 기술 스택

- 백엔드: Supabase (lyrzrgvugntdqvxdxyfk.supabase.co)
- 배포: Vercel (sugarcat.vercel.app)
- AI: Anthropic API (/api/proxy 경유)
- 서비스워커: sw.js (캐시 비활성화 상태)

## 주의사항

- iOS PWA: 숨겨진 fixed 모달이 터치 차단할 수 있음 → pointer-events:none 필요
- Supabase RLS 활성화 상태
- 단일 파일 구조 (index.html ~7000줄) — 수정 시 전체 맥락 고려
