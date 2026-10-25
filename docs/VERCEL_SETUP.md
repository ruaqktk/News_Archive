# Vercel 연결 안내

GitHub 연결 계정 `ruaqktk`로 `ruaqktk/News_Archive`에 실제 파일 쓰기가 성공했고, **2026-10-26에 `newsarchive` 프로젝트의 Vercel 최초 배포 성공을 확인했습니다.** 아래는 연결을 유지하거나 다시 설정할 때 참고할 안내입니다.

운영 주소(사용자 제공): [혜원이의 뉴스 아카이브](https://newsarchive-rho.vercel.app/)

## 1. GitHub 저장소 확인

ChatGPT의 GitHub 연결은 `News_Archive` 저장소에 접근하고 파일을 쓸 수 있는 상태입니다. [ruaqktk/News_Archive](https://github.com/ruaqktk/News_Archive)의 `main` 브랜치에 전체 소스인 `package.json`, `vercel.json`, `public/`, `scripts/`가 있는지 확인한 뒤 Import를 진행합니다. Vercel에도 이 저장소에 접근할 수 있는 GitHub 계정을 연결합니다.

압축 파일에서 직접 올리는 경우 프로젝트의 **내용물**을 저장소 루트에 올립니다. `News_Archive/News_Archive`처럼 폴더가 한 단계 더 들어가지 않게 하세요. 기존 저장소를 Import해야 정기 데이터가 같은 사이트에 반영됩니다.

## 2. Vercel에 저장소 연결

1. [Vercel 새 프로젝트](https://vercel.com/new)를 엽니다.
2. **Import Git Repository**에서 GitHub 연결을 선택합니다.
3. 목록에 저장소가 없으면 GitHub 연결의 접근 허용 저장소에 `News_Archive`를 추가합니다.
4. `ruaqktk/News_Archive` 옆 **Import**를 선택합니다.
5. Project Name은 예를 들어 `news-archive`로 입력합니다. 사용 가능 여부는 화면에서 확인합니다.
6. 아래 설정을 확인한 뒤 **Deploy**를 선택합니다.

| 항목 | 설정값 |
|---|---|
| Framework Preset | Other |
| Root Directory | `./` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | 비움 |
| Environment Variables | 추가하지 않음 |

`vercel.json`에 설정이 포함돼 있어 자동 적용될 수 있습니다. 새 프로젝트를 만들거나 도메인을 변경할 때는 Vercel 화면의 실제 주소를 확인하세요. 프로젝트 이름만 보고 주소를 추정하지 마세요.

## 3. 자동 반영 확인

1. 사이트에서 달력 날짜 선택, 언론사 필터, 검색과 네이버 신문보기 링크가 동작하는지 확인합니다.
2. GitHub의 데이터 파일을 실제 새 브리핑으로 갱신합니다.
3. Vercel의 **Deployments**에서 새 배포가 성공했는지 확인합니다.
4. 사이트의 마지막 수집 시각과 기사 목록을 확인합니다.

ChatGPT 예약은 검증한 기사를 GitHub의 `public/data/archive.json`에 누적하는 구성입니다. GitHub 저장과 Vercel 최초 배포는 별도로 확인하며, 배포 전에도 기사 데이터는 누적할 수 있습니다. 사이트 반영 여부는 실제 배포 성공과 화면의 데이터를 확인한 뒤 판단합니다.

## 자주 막히는 부분

### 저장소가 목록에 안 보임

Vercel에 연결한 GitHub 계정과 저장소 접근 범위를 확인합니다. 빈 저장소에는 먼저 파일을 올려야 합니다.

### 배포가 커밋 작성자 문제로 막힘

Vercel의 GitHub 계정 연결을 확인합니다. 특히 Hobby의 비공개 저장소는 커밋 작성자와 소유 계정의 연결 조건이 있습니다. 현재 지정 저장소는 조회 시 공개 상태였습니다.

### 배포는 성공했는데 기사가 갱신되지 않음

`public/data/archive.json`이 운영 브랜치에 반영됐는지, 새 Vercel 빌드가 성공했는지 순서대로 확인합니다. 파일 저장 완료와 웹사이트 배포 완료는 서로 다른 상태입니다.

## 공식 안내

- [Vercel: GitHub 연결과 자동 배포](https://vercel.com/docs/git/vercel-for-github)
- [Vercel: 빌드 명령과 출력 폴더](https://vercel.com/docs/builds/configure-a-build)
- [Vercel: 커밋 작성자와 배포 권한](https://vercel.com/docs/deployments/troubleshoot-project-collaboration)
