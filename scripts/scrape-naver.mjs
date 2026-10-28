// 네이버 신문보기(지면)에서 9개 언론사의 당일 지면 기사를 전부 수집한다.
// 사용법: node scripts/scrape-naver.mjs [YYYY-MM-DD] [출력폴더]
// 출력: <폴더>/listing.json (목록·메타데이터), <폴더>/bodies.jsonl (aid별 본문)
// 본문은 공개 레포에 커밋하지 않고 GitHub Actions artifact로만 잠깐 보관한다.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PRESS_CODES, classifyTitle, newspaperPageUrl, onDomain, parseArticlePage, parseNewspaperPage } from './naver-print.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const archivePath = fileURLToPath(new URL('../public/data/archive.json', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function kstNow() {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
  return `${parts.replace(' ', 'T')}+09:00`;
}

async function fetchHtml(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await sleep(1500 * attempt);
    }
  }
  throw new Error(lastError.message);
}

async function scrapePublisher(publisher, date) {
  const pageUrl = newspaperPageUrl(publisher.id, date);
  let listing;
  try {
    listing = parseNewspaperPage(await fetchHtml(pageUrl), publisher.id, date);
  } catch (error) {
    return { publisherId: publisher.id, pageUrl, status: 'blocked', note: `신문보기 접근 실패: ${error.message}`, articles: [], bodies: [] };
  }
  if (listing.length === 0) {
    return { publisherId: publisher.id, pageUrl, status: 'not_checked', note: '지면 기사를 찾지 못했습니다(휴간이거나 페이지 구조 변경).', articles: [], bodies: [] };
  }
  const articles = [];
  const bodies = [];
  let failed = 0;
  for (const item of listing) {
    await sleep(200);
    const entry = { publisherId: publisher.id, aid: item.aid, page: item.page, title: item.title, naverUrl: item.naverUrl, originalUrl: null, publishedAt: null, bodyLength: 0, titleHint: classifyTitle(item.title)?.type ?? null, fetchError: null };
    try {
      const detail = parseArticlePage(await fetchHtml(item.naverUrl));
      const original = detail.originalUrl?.replace(/^http:\/\//, 'https://');
      entry.originalUrl = original && onDomain(original, publisher.domain) ? original : null;
      entry.publishedAt = detail.publishedAt;
      entry.bodyLength = detail.text.length;
      if (detail.text) bodies.push({ publisherId: publisher.id, aid: item.aid, text: detail.text });
    } catch (error) {
      entry.fetchError = error.message;
      failed += 1;
    }
    articles.push(entry);
  }
  return {
    publisherId: publisher.id, pageUrl,
    status: failed ? 'partial' : 'checked',
    note: `지면 기사 ${listing.length}건 수집${failed ? `, 기사 페이지 ${failed}건 실패` : ''}.`,
    articles, bodies,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const date = process.argv[2] || kstNow().slice(0, 10);
  const outDir = process.argv[3] || join('out', date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('사용법: node scripts/scrape-naver.mjs [YYYY-MM-DD] [출력폴더]');
    process.exit(1);
  }
  const { publishers } = JSON.parse(await readFile(archivePath, 'utf8'));
  // 언론사별로는 병렬, 한 언론사 안에서는 순차 요청
  const results = await Promise.all(publishers.map((publisher) => scrapePublisher(publisher, date)));
  for (const [index, result] of results.entries()) console.error(`${publishers[index].name}: ${result.status} — ${result.note}`);

  await mkdir(outDir, { recursive: true });
  const listing = {
    date,
    scrapedAt: kstNow(),
    pressCodes: PRESS_CODES,
    coverage: results.map(({ publisherId, pageUrl, status, note, articles }) => ({ publisherId, pageUrl, status, note, articleCount: articles.length })),
    articles: results.flatMap((result) => result.articles),
  };
  await writeFile(join(outDir, 'listing.json'), `${JSON.stringify(listing, null, 2)}\n`);
  await writeFile(join(outDir, 'bodies.jsonl'), results.flatMap((result) => result.bodies).map((body) => JSON.stringify(body)).join('\n') + '\n');
  console.error(`총 ${listing.articles.length}건, 본문 ${results.reduce((n, r) => n + r.bodies.length, 0)}건 → ${outDir}`);
  if (!results.some((result) => ['checked', 'partial'].includes(result.status))) {
    console.error('모든 언론사 수집에 실패했습니다.');
    process.exitCode = 2;
  }
}
