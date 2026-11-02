# 뉴스 브리핑과 아카이빙 운영 지침

## 파이프라인 (2026-10-28 이후)

| 단계 | 담당 | 시각(KST) | 내용 |
|---|---|---|---|
| 1. 지면 전체 수집 | 비공개 레포 `ruaqktk/News_Archive_raw`의 GitHub Actions (`scrape.yml`) + Claude 보조 실행 | 평일 05:30·08:30 예약 (실제로는 3시간 안팎 늦게 실행됨, 공휴일 제외) | 네이버 신문보기에서 12개사 당일 지면 기사 목록 전체와 후보 기사 본문을 `days/<날짜>/`에 커밋 |
| 2. 선별·요약·반영 | Claude 예약 작업 | 평일 09:00 (공휴일 제외) | `config/classification-rules.json` 제목 규칙과 `docs/CLASSIFICATION.md` 기준으로 단독·기획 선별, 카드 요약·상세 요약 작성, `public/data/archive.json` 병합·커밋, 브리핑 알림 |
| 2-1. 전날 보충 | 같은 Claude 예약 작업 | 평일 09:00 | 직전 평일 지면을 다시 수집해, 아침 브리핑 이후 네이버에 늦게 붙은 기사 중 단독·기획만 그날 아카이브에 추가 |
| 3. 배포 | Vercel | 커밋 직후 | `main` 변경 시 자동 배포 |

- 수집 코드(`scripts/scrape-naver.mjs`, `scripts/naver-print.mjs`)는 이 공개 레포에 있고, 비공개 레포의 Actions가 이 레포를 체크아웃해 실행합니다.
- 기사 본문은 비공개 레포에만 두고 14일 후 삭제합니다. 공개 레포와 사이트에는 제목, URL, 면, 자체 요약만 올립니다.
- 사이트의 기사 링크는 네이버 신문보기 개별 기사 주소(`n.news.naver.com/article/newspaper/<언론사코드>/<기사ID>?date=YYYYMMDD`)입니다.
- 이전 ChatGPT 예약 작업(단독·기획 아침 브리핑)은 이 파이프라인으로 대체되며, 같은 `archive.json`에 쓰지 않도록 꺼야 합니다.

## 사이트 데이터 분할

원본은 계속 `public/data/archive.json` 하나이며, 매일 작업도 이 파일에만 씁니다. 사이트가 쌓인 데이터를 한꺼번에 받지 않도록 `npm run build`(Vercel 배포 포함)가 `scripts/split-archive.mjs`로 아래 파일을 만들고, 배포본에는 원본을 넣지 않습니다.

| 파일 | 내용 | 받는 때 |
|---|---|---|
| `data/index.json` | 언론사 목록, 날짜별 기사 수 | 첫 화면(날짜당 수십 바이트) |
| `data/days/YYYY-MM-DD.json` | 그날 지면 전체(요약·상세 요약 포함) | 그 날짜를 보거나 기사를 열 때 |
| `data/search/YYYY-MM.json` | 그달 기사의 제목·요약·상세 요약 문장 | 검색할 때, 최신 달부터 차례로 |

## 수집 실행 보장과 실패 진단

- GitHub 예약 실행은 3시간 안팎 늦게 도는 일이 많습니다(2026-10-29·30, 11-02 모두 예정보다 약 3시간 늦음). 그래서 05:30·08:30 두 번 걸어 둡니다. 05:30 실행은 대개 09:00 브리핑 전에 끝나고, 08:30 실행은 늦게 돌면서 오전에 뒤늦게 붙은 지면 기사를 다시 확인합니다.
- 예약 실행도 매번 목록을 다시 확인합니다. 이미 받은 기사는 재사용하고 새 기사와 실패분만 요청하므로 몇십 초~2분이면 끝납니다. 두 실행이 같은 날짜를 동시에 커밋하면 나중 수집 결과를 남깁니다.
- 09:00 브리핑 작업은 시작할 때 자료가 없거나 불완전하면 직접 수집을 실행하고 기다립니다(정시 보장).
- 실패 원인은 `listing.json`의 `fetchStats`(요청 수, 재시도, 시간 초과, HTTP 상태별 횟수, 5초 넘은 느린 응답 수, 평균·최대 응답 시간, 소요 분)와 기사별 `fetchError`로 확인합니다. `time_limit`은 수집 시간 한도(35분)를 다 써서 요청하지 못한 기사입니다.

## 주말·공휴일

수집(Actions)과 정리(Claude 예약 작업) 모두 평일에만 돌고, `config/holidays-kr.json`에 있는 공휴일에는 건너뜁니다. `node scripts/workday.mjs [날짜]`가 `run` 또는 `skip <이유>`를 알려줍니다. 매년 말 다음 해 공휴일(대체공휴일 포함)을 이 파일에 추가하세요. 수동 실행은 날짜와 상관없이 수집합니다.

## Claude 예약 작업 절차

```
L=../news_archive_raw/days/<날짜>/listing.json
B=../news_archive_raw/days/<날짜>/bodies.jsonl
# 1. 제목 규칙으로 1차 판정 (자동 단독·기획·제외 + 검토 필요 목록)
node scripts/triage.mjs $L
# 2. 검토 필요 기사만 본문 확인 후 판단 → config/classification-rules.json 연재 등록부에 기록 → 다시 1번
node scripts/inspect-day.mjs bodies $B <aid> ...
# 3. 선정 기사 초안 생성 후 기사마다 summary·detail 작성
node scripts/triage.mjs $L --selections > selections.json
# 4. run 생성 → 병합 → 검증
node scripts/build-run.mjs $L selections.json > run.json
node scripts/merge-run.mjs run.json
npm run check && npm test && npm run build
```

**전날 보충.** 브리핑 작업은 오늘 지면을 처리한 뒤 직전 평일 P(`node scripts/workday.mjs --prev D`)를 한 번 더 봅니다. P를 수동 수집으로 다시 받고, 1번과 3번에 `--new`를 붙여 그날 아카이브에 이미 있는 기사를 뺀 새 기사만 판정합니다. `merge-run.mjs`는 기존 기사를 그대로 두고 새 기사만 더합니다.

```
node scripts/triage.mjs ../news_archive_raw/days/<P>/listing.json --new
node scripts/triage.mjs ../news_archive_raw/days/<P>/listing.json --selections --new > selections-P.json
```

**늦게 올라오는 기사.** 네이버 신문보기는 언론사가 지면 기사를 오전 늦게 지면 목록에 추가로 붙이는 경우가 있습니다(2026-11-02 경향신문 1·5·9·18면 기사 등 12건이 08:57 수집 뒤에 붙음. 온라인 출고는 06:00). 이런 기사는 다음 날 아침 전날 보충으로 하루 늦게 아카이브에 들어갑니다.

`selections.json`은 `[{ "aid", "publisherId", "type", "evidence", "summary", "detail" }]` 배열입니다. `detail`은 `{ background, points[], significance, terms[] }` 구조이며 작성 기준은 `docs/CLASSIFICATION.md` 5절에 있습니다. 원문 URL을 확인하지 못한 기사는 `build-run.mjs`가 자동으로 제외하고 coverage note에 적습니다.

## 수집 대상


| ID | 언론사 | 본지 도메인 | 네이버 언론사 코드 |
|---|---|---|---|
| chosun | 조선일보 | chosun.com | 023 |
| joongang | 중앙일보 | joongang.co.kr | 025 |
| donga | 동아일보 | donga.com | 020 |
| hani | 한겨레신문 | hani.co.kr | 028 |
| hankookilbo | 한국일보 | hankookilbo.com | 469 |
| khan | 경향신문 | khan.co.kr | 032 |
| kmib | 국민일보 | kmib.co.kr | 005 |
| segye | 세계일보 | segye.com | 022 |
| seoul | 서울신문 | seoul.co.kr | 081 |
| sedaily | 서울경제 | sedaily.com | 011 |
| mk | 매일경제 | mk.co.kr | 009 |
| hankyung | 한국경제 | hankyung.com | 015 |

별도 계열 매체는 자동 포함하지 않습니다. 공식 기사 목록, 제공되는 RSS, 기획/연재 목록과 최신 검색을 함께 사용합니다. 검색 결과 수집은 모든 기사 누락이 없다는 보장이 아니므로 확인 범위를 기록합니다.

## 데이터 계약

웹사이트는 `public/data/archive.json` 하나를 읽습니다.

```json
{
  "schemaVersion": 1,
  "timezone": "Asia/Seoul",
  "updatedAt": null,
  "publishers": [],
  "runs": []
}
```

위 형태는 구조 설명용입니다. 실제 파일에는 지정한 12개 publisher 객체가 반드시 있어야 합니다. 각 객체는 `id`, `name`, `domain`, `url`을 가집니다.

일일 JSON은 아래 필드를 가진 run 객체 한 개입니다.

| 필드 | 내용 |
|---|---|
| date | 브리핑 날짜, YYYY-MM-DD |
| generatedAt | 결과 생성 시각, 초와 시간대 포함 ISO 8601 |
| windowStart / windowEnd | 수집 대상 최초 발행시각 구간 |
| status | complete / partial / failed |
| note | 실행 범위와 제한 설명 |
| coverage | 12개 언론사의 상태와 기사 수 |
| articles | 검증한 기사 배열 |

coverage 객체: `publisherId`, `status`(checked/partial/blocked/not_checked), `note`, `articleCount`.

article 객체: `id`, `publisherId`, `type`(exclusive/feature), `title`, `url`, `publishedAt`, `collectedAt`, `summary`, `summaryBasis`(full_text/partial_text/metadata_only), `classificationEvidence`.

`publishedAt`은 확인할 수 없으면 null이지만, 기간에 들어온다는 증거까지 없으면 기사 목록에 넣지 않고 수집 제한으로 보고합니다. complete는 12개 언론사 모두 정해진 조사 범위를 확인했을 때만 사용합니다.

## 검증

```bash
npm run check
npm test
npm run build
```

브리핑의 기사 사실관계는 원문 확인으로, 데이터 보존과 구조는 코드로 각각 검증합니다.

