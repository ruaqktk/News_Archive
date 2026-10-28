// 수집 목록(listing.json)과 Claude의 선택 결과(selections.json)를 합쳐 일일 run JSON을 만든다.
// 사용법: node scripts/build-run.mjs <listing.json> <selections.json> > run.json
// selections.json 형식: [{ "aid": "0004006341", "publisherId": "chosun", "type": "exclusive"|"feature",
//                          "section": "정치|경제|사회|생활·문화|세계|IT·과학|스포츠", "evidence": "분류 근거", "summary": "카드용 1~2문장 요약",
//                          "detail": { "background", "points": [...], "significance", "terms": [{ "term", "description" }] } }]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PRESS_CODES, SECTIONS } from './naver-print.mjs';
import { kstNow } from './scrape-naver.mjs';

const archivePath = fileURLToPath(new URL('../public/data/archive.json', import.meta.url));

export function buildRun(listing, selections, publishers, generatedAt) {
  const byKey = new Map(listing.articles.map((article) => [`${article.publisherId}:${article.aid}`, article]));
  const errors = [];
  const skipped = new Map();
  const articles = [];
  const seen = new Set();
  for (const [index, selection] of selections.entries()) {
    const key = `${selection.publisherId}:${selection.aid}`;
    const source = byKey.get(key);
    if (!source) { errors.push(`selections[${index}]: 목록에 없는 기사(${key})`); continue; }
    if (seen.has(key)) { errors.push(`selections[${index}]: 중복 선택(${key})`); continue; }
    seen.add(key);
    if (!['exclusive', 'feature'].includes(selection.type)) { errors.push(`selections[${index}]: type 오류`); continue; }
    if (!selection.evidence?.trim()) { errors.push(`selections[${index}]: evidence 없음`); continue; }
    if (!SECTIONS.includes(selection.section)) { errors.push(`selections[${index}]: section은 ${SECTIONS.join(', ')} 중 하나여야 합니다(${key}: ${source.title})`); continue; }
    if (!source.originalUrl) {
      skipped.set(source.publisherId, [...(skipped.get(source.publisherId) ?? []), source.title]);
      continue;
    }
    const summary = (selection.summary ?? '').trim();
    articles.push({
      id: `${source.publisherId}-${PRESS_CODES[source.publisherId]}-${source.aid}`,
      publisherId: source.publisherId,
      type: selection.type,
      section: selection.section,
      title: source.title,
      url: source.originalUrl,
      naverUrl: source.naverUrl,
      naverUrlSource: 'naver_newspaper_page',
      page: source.page,
      publishedAt: source.publishedAt,
      newspaperDate: listing.date,
      newspaperEvidence: `네이버 신문보기 ${listing.date} ${source.page ? `${source.page}면` : '지면'} 목록`,
      collectedAt: listing.scrapedAt,
      summary,
      summaryBasis: summary ? (source.bodyLength > 0 ? 'full_text' : 'metadata_only') : 'metadata_only',
      classificationEvidence: selection.evidence.trim(),
      ...(selection.detail ? { detail: selection.detail } : {}),
    });
  }
  if (errors.length) throw new Error(errors.join('\n'));

  const coverage = listing.coverage.map((entry) => {
    const count = articles.filter((article) => article.publisherId === entry.publisherId).length;
    const missing = skipped.get(entry.publisherId) ?? [];
    const note = [entry.note, `단독·기획 ${count}건 선정.`, missing.length ? `원문 URL 없어 제외: ${missing.join(' / ')}` : ''].filter(Boolean).join(' ');
    const status = entry.status === 'checked' && missing.length ? 'partial' : entry.status;
    return { publisherId: entry.publisherId, status, note, articleCount: count };
  });
  const allChecked = coverage.every((entry) => entry.status === 'checked');
  const anyChecked = coverage.some((entry) => ['checked', 'partial'].includes(entry.status));
  return {
    date: listing.date,
    generatedAt,
    windowStart: `${listing.date}T00:00:00+09:00`,
    windowEnd: listing.scrapedAt,
    collectionMode: 'naver_newspaper',
    status: allChecked ? 'complete' : anyChecked ? 'partial' : 'failed',
    note: `네이버 신문보기 ${listing.date}자 지면 전체(${listing.articles.length}건)를 GitHub Actions가 수집하고, Claude가 단독·기획 선별과 요약을 작성했습니다.`,
    coverage,
    articles,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [listingPath, selectionsPath] = process.argv.slice(2);
  if (!listingPath || !selectionsPath) {
    console.error('사용법: node scripts/build-run.mjs <listing.json> <selections.json> > run.json');
    process.exit(1);
  }
  try {
    const listing = JSON.parse(await readFile(listingPath, 'utf8'));
    const selections = JSON.parse(await readFile(selectionsPath, 'utf8'));
    const { publishers } = JSON.parse(await readFile(archivePath, 'utf8'));
    const run = buildRun(listing, selections, publishers, kstNow());
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
  } catch (error) {
    console.error(`run 생성 실패:\n${error.message}`);
    process.exitCode = 1;
  }
}
