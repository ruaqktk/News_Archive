# 혜원이의 뉴스 아카이브

조선일보, 중앙일보, 동아일보, 한겨레신문, 한국일보, 경향신문, 국민일보, 세계일보, 서울신문, 서울경제, 매일경제, 한국경제의 **단독·기획 기사**를 날짜별·언론사별로 읽는 정적 웹사이트입니다.

## 준비된 기능

- 월별 달력으로 아카이브 날짜 선택, 언론사·단독/기획 필터와 제목·요약 검색
- 최신순·언론사순 정렬, 네이버 신문보기 링크와 2~3문장 요약
- 언론사별 확인 범위, 본문 접근 제한, 마지막 수집 시각 표시
- 공식 도메인·날짜·중복·기사 수를 검사하는 데이터 검증
- 기존 날짜의 기사를 보존하는 반복 실행 병합
- Vercel 설정 파일과 의존성 없는 빌드

화면에는 2026-10-26 새벽에 원문·발행시각을 검증한 **단독 5건의 초기 샘플**이 있습니다. 전체 기사 수집 결과가 아니며 기획 기사를 임의로 만들어 넣지 않았습니다.

## 현재 연결 상태

매일 아침 자동으로 갱신됩니다. 자세한 흐름은 [docs/AUTOMATION.md](docs/AUTOMATION.md)를 보세요.

1. 평일 07:50 KST — 비공개 레포 `News_Archive_raw`의 GitHub Actions가 네이버 신문보기에서 12개사 당일 지면 기사를 전부 수집
2. 평일 08:47 KST — Claude 예약 작업이 [선별 기준](docs/CLASSIFICATION.md)에 따라 단독·기획 기사를 고르고 요약해 `public/data/archive.json`에 반영, 브리핑 알림 발송
3. 커밋 직후 — Vercel 자동 배포

운영 주소: [혜원이의 뉴스 아카이브](https://newsarchive-rho.vercel.app/)

## Vercel 배포

자세한 화면 안내는 [docs/VERCEL_SETUP.md](docs/VERCEL_SETUP.md)를 참고하세요.

| 설정 | 값 |
|---|---|
| Git 저장소 | `ruaqktk/News_Archive` |
| Production Branch | `main` |
| Framework Preset | Other |
| Root Directory | 저장소 루트 (`./`) |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | 비움 — 추가 패키지 없음 |
| Environment Variables | 필요 없음 |

빌드 명령과 출력 폴더 설정은 `vercel.json`에 포함되어 있습니다. 운영 브랜치에 데이터가 저장되고 Vercel 빌드가 성공해야 웹사이트에 반영됩니다. 이 웹사이트 자체는 뉴스 수집기를 실행하지 않습니다. 뉴스 수집은 ChatGPT 예약 작업이 담당합니다.

## 로컬 확인

Node.js 22 이상에서 실행합니다. 외부 npm 패키지 설치는 필요하지 않습니다.

```bash
npm run check
npm test
npm run build
python3 -m http.server 8000 --directory dist
```

브라우저에서 `http://localhost:8000`을 엽니다. `index.html`을 파일로 직접 열면 브라우저가 JSON 읽기를 제한할 수 있으므로 HTTP 서버를 사용하세요.

## 새 브리핑 반영

정기 결과 파일은 `news-briefing-YYYY-MM-DD.json`이라는 **일일 run 객체**입니다. 다음 명령은 기존 날짜의 기사를 보존하면서 병합합니다.

```bash
node scripts/merge-run.mjs /path/to/news-briefing-2026-10-27.json
npm run build
```

검증에 실패하면 기존 아카이브는 변경하지 않습니다. 병합이 성공하면 `public/data/archive.json`을 저장소에 커밋합니다. 반복 실행 시 같은 URL의 중복을 제거하며, 다른 날짜에 이미 저장된 동일 URL은 다시 추가하지 않습니다. 내용이 바뀐 기존 기사 수정은 해당 날짜의 기록을 검토해 갱신하세요.

자동 저장 운영 지침과 데이터 구조는 [docs/AUTOMATION.md](docs/AUTOMATION.md)에 있습니다. 매번 저장소의 최신 파일을 읽고 병합한 뒤 현재 파일 SHA를 조건으로 갱신해, 이전 날짜의 기록과 다른 변경을 보존합니다. Vercel 연결 전에도 GitHub 데이터 누적은 독립적으로 사용할 수 있습니다.

## 파일 구성

- `public/`: 사용자에게 제공되는 웹사이트와 기사 데이터
- `scripts/`: 검증·병합·빌드 도구
- `tests/`: 반복 실행과 데이터 보존 검증
- `docs/`: 설정 안내, 수집 지침, 출처 경로
- `dist/`: 빌드 결과 (버전 관리 제외)

저장하는 기사 내용은 제목, 출처 URL, 발행시각, 짧은 자체 요약, 분류 근거입니다. 원문 전문과 사진은 복제하지 않습니다.
