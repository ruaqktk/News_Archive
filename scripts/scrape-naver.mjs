// 네이버 신문보기(지면)에서 9개 언론사의 당일 지면 기사를 전부 수집한다.
// 사용법: node scripts/scrape-naver.mjs [YYYY-MM-DD] [출력폴더]
// 출력: <폴더>/listing.json (목록·메타데이터), <폴더>/bodies.jsonl (aid별 본문)
// 본문은 공개 레포에 커밋하지 않고 비공개 레포(News_Archive_raw)에만 보관한다.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadRules, triageTitle } from './triage.mjs';
import { PRESS_CODES, newspaperPageUrl, onDomain, parseArticlePage, parseNewspaperPage } from './naver-print.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const archivePath = fileURLToPath(new URL('../public/data/archive.json', import.meta.url));
const DEADLINE = Date.now() + Number(process.env.SCRAPE_BUDGET_MINUTES || 20) * 60000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function kstNow() {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
  return `${parts.replace(' ', 'T')}+09:00`;
}

async function fetchHtml(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await sleep(2000 * attempt);
    }
  }
  throw new Error(lastError.message);
}

async function fetchListing(publisher, date) {
  const pageUrl = newspaperPageUrl(publisher.id, date);
  try {
    const items = parseNewspaperPage(await fetchHtml(pageUrl), publisher.id, date);
    if (items.length === 0) return { pageUrl, items, status: 'not_checked', error: '지면 기사를 찾지 못했습니다(휴간이거나 페이지 구조 변경).' };
    return { pageUrl, items, status: 'checked', error: null };
  } catch (error) {
    return { pageUrl, items: [], status: 'blocked', error: `신문보기 접근 실패: ${error.message}` };
  }
}

async function fetchDetail(entry, domain, bodies) {
  try {
    const detail = parseArticlePage(await fetchHtml(entry.naverUrl));
    const original = detail.originalUrl?.replace(/^http:\/\//, 'https://');
    entry.originalUrl = original && onDomain(original, domain) ? original : null;
    entry.publishedAt = detail.publishedAt;
    entry.bodyLength = detail.text.length;
    entry.fetchError = null;
    if (detail.text) bodies.set(`${entry.publisherId}:${entry.aid}`, { publisherId: entry.publisherId, aid: entry.aid, text: detail.text });
  } catch (error) {
    entry.fetchError = error.message;
  }
}

// 동시 요청 수를 제한해 순서대로 처리한다. 네이버가 몰린 요청에 응답을 늦추므로 낮게 유지한다.
async function runPool(tasks, concurrency) {
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next++];
      if (Date.now() > DEADLINE) { task.skip(); continue; }
      await task.run();
      await sleep(400);
      done += 1;
      if (done % 25 === 0) console.error(`후보 기사 ${done}/${tasks.length}건 처리`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function readPrevious(outDir, date) {
  try {
    const listing = JSON.parse(await readFile(join(outDir, 'listing.json'), 'utf8'));
    if (listing.date !== date) return null;
    const lines = (await readFile(join(outDir, 'bodies.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { listing, bodies: lines };
  } catch { return null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const date = process.argv[2] || kstNow().slice(0, 10);
  const outDir = process.argv[3] || join('out', date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('사용법: node scripts/scrape-naver.mjs [YYYY-MM-DD] [출력폴더]');
    process.exit(1);
  }
  const { publishers } = JSON.parse(await readFile(archivePath, 'utf8'));
  const domains = new Map(publishers.map((publisher) => [publisher.id, publisher.domain]));
  // 제목 규칙(config/classification-rules.json)으로 자동 제외되지 않는 기사만 본문을 받는다.
  const rules = loadRules();
  const triageFields = (title, publisherId) => {
    const { decision, rule } = triageTitle(title, publisherId, rules);
    return { candidate: decision !== 'exclude', triage: decision, triageRule: rule };
  };

  // 같은 날짜를 다시 돌리면 이미 성공한 기사는 재사용하고 실패분만 다시 요청한다.
  const previous = await readPrevious(outDir, date);
  const previousByKey = new Map((previous?.listing.articles ?? []).map((article) => [`${article.publisherId}:${article.aid}`, article]));
  const bodies = new Map((previous?.bodies ?? []).map((body) => [`${body.publisherId}:${body.aid}`, body]));

  // 1단계: 지면 목록 (언론사별 순차)
  const listings = [];
  for (const publisher of publishers) {
    listings.push(await fetchListing(publisher, date));
    await sleep(500);
  }
  const entries = [];
  for (const [index, publisher] of publishers.entries()) {
    for (const item of listings[index].items) {
      const key = `${publisher.id}:${item.aid}`;
      const old = previousByKey.get(key);
      const entry = { publisherId: publisher.id, aid: item.aid, page: item.page, title: item.title, naverUrl: item.naverUrl, ...triageFields(item.title, publisher.id), originalUrl: null, publishedAt: null, bodyLength: 0, fetchError: null };
      if (old && old.candidate && !old.fetchError) Object.assign(entry, { originalUrl: old.originalUrl, publishedAt: old.publishedAt, bodyLength: old.bodyLength, reused: true });
      entries.push(entry);
    }
  }

  // 2단계: 후보 기사 페이지 (동시 2건), 3단계: 실패분 재시도 (순차)
  const pending = () => entries.filter((entry) => entry.candidate && !entry.reused && (entry.bodyLength === 0 && !entry.originalUrl));
  const asTask = (entry) => ({ run: () => fetchDetail(entry, domains.get(entry.publisherId), bodies), skip: () => { entry.fetchError = 'time_limit'; } });
  await runPool(pending().map(asTask), 2);
  const retry = entries.filter((entry) => entry.candidate && entry.fetchError);
  if (retry.length) {
    console.error(`실패 ${retry.length}건 재시도`);
    await sleep(5000);
    await runPool(retry.map(asTask), 1);
  }

  const coverage = publishers.map((publisher, index) => {
    const mine = entries.filter((entry) => entry.publisherId === publisher.id);
    const candidates = mine.filter((entry) => entry.candidate);
    const failed = candidates.filter((entry) => entry.fetchError).length;
    const { status, error, pageUrl } = listings[index];
    const note = error ?? `지면 기사 ${mine.length}건 수집, 후보 ${candidates.length}건 기사 페이지 확인${failed ? `, ${failed}건 실패` : ''}.`;
    return { publisherId: publisher.id, pageUrl, status: status === 'checked' && failed ? 'partial' : status, note, articleCount: mine.length };
  });
  for (const entry of entries) delete entry.reused;
  for (const [index, publisher] of publishers.entries()) console.error(`${publisher.name}: ${coverage[index].status} — ${coverage[index].note}`);

  await mkdir(outDir, { recursive: true });
  const listing = { date, scrapedAt: kstNow(), pressCodes: PRESS_CODES, coverage, articles: entries };
  await writeFile(join(outDir, 'listing.json'), `${JSON.stringify(listing, null, 2)}\n`);
  const keep = new Set(entries.map((entry) => `${entry.publisherId}:${entry.aid}`));
  await writeFile(join(outDir, 'bodies.jsonl'), [...bodies.values()].filter((body) => keep.has(`${body.publisherId}:${body.aid}`)).map((body) => JSON.stringify(body)).join('\n') + '\n');
  console.error(`총 ${entries.length}건, 본문 ${bodies.size}건 → ${outDir}`);
  if (!coverage.some((entry) => ['checked', 'partial'].includes(entry.status))) {
    console.error('모든 언론사 수집에 실패했습니다.');
    process.exitCode = 2;
  }
}
