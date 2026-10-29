// 원본 아카이브(public/data/archive.json)를 사이트가 필요한 만큼만 받도록 나눈다.
// 매일 작업은 계속 archive.json 하나에만 쓰고, 이 분할은 빌드(배포) 때 자동으로 만든다.
//
//   data/index.json            언론사 목록 + 날짜별 기사 수 (첫 화면·달력용, 작게 유지)
//   data/days/YYYY-MM-DD.json  그날 지면 전체 (목록 화면·기사 상세용)
//   data/search/YYYY-MM.json   그달 기사의 검색용 텍스트 (검색할 때만 받음)

export function detailPieces(detail) {
  if (!detail) return [];
  return [
    detail.background,
    ...(detail.points ?? []),
    detail.significance,
    ...(detail.terms ?? []).map((item) => `${item.term}: ${item.description}`),
  ].filter(Boolean);
}

export function splitArchive(archive) {
  const index = {
    schemaVersion: 2,
    timezone: archive.timezone,
    updatedAt: archive.updatedAt,
    publishers: archive.publishers,
    dates: [],
    months: [],
  };
  const days = new Map();
  const search = new Map();

  for (const run of [...archive.runs].sort((a, b) => b.date.localeCompare(a.date))) {
    const exclusive = run.articles.filter((article) => article.type === 'exclusive').length;
    index.dates.push({ date: run.date, total: run.articles.length, exclusive, feature: run.articles.length - exclusive });
    days.set(run.date, run);

    const month = run.date.slice(0, 7);
    if (!search.has(month)) search.set(month, []);
    for (const article of run.articles) {
      search.get(month).push({
        date: run.date,
        id: article.id,
        publisherId: article.publisherId,
        type: article.type,
        section: article.section ?? null,
        page: article.page ?? null,
        title: article.title,
        summary: article.summary ?? '',
        pieces: detailPieces(article.detail),
      });
    }
  }
  index.months = [...search.keys()].sort().reverse();
  return { index, days, search };
}
