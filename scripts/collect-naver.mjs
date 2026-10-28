// 네이버 신문보기(지면)에서 오늘자 단독·기획 기사를 모아 일일 run JSON을 만든다.
// 사용법: node scripts/collect-naver.mjs [YYYY-MM-DD] > run.json
// GEMINI_API_KEY 환경변수가 있으면 2~3문장 요약을 붙이고, 없으면 요약 없이(metadata_only) 저장한다.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PRESS_CODES, classifyTitle, newspaperPageUrl, onDomain, parseArticlePage, parseNewspaperPage } from './naver-print.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const archivePath = fileURLToPath(new URL('../public/data/archive.json', import.meta.url));

function kstNow() {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
  return `${parts.replace(' ', 'T')}+09:00`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchHtml(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await sleep(1000 * attempt);
    }
  }
  throw new Error(`${url} 요청 실패: ${lastError.message}`);
}

async function summarize(title, text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || text.length < 80) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const prompt = `다음 신문 기사를 한국어 2~3문장으로 요약하세요. 원문 문장을 그대로 옮기지 말고 핵심 사실만 자신의 말로 쓰세요. 요약문만 출력하세요.\n\n제목: ${title}\n\n본문:\n${text.slice(0, 6000)}`;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 400 } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const summary = data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('').trim();
    return summary || null;
  } catch (error) {
    console.error(`요약 실패(${title}): ${error.message}`);
    return null;
  }
}

async function collectPublisher(publisher, date) {
  const pageUrl = newspaperPageUrl(publisher.id, date);
  let listing;
  try {
    listing = parseNewspaperPage(await fetchHtml(pageUrl), publisher.id, date);
  } catch (error) {
    return { articles: [], coverage: { publisherId: publisher.id, status: 'blocked', note: `신문보기 접근 실패: ${error.message}`, articleCount: 0 } };
  }
  if (listing.length === 0) {
    return { articles: [], coverage: { publisherId: publisher.id, status: 'not_checked', note: `신문보기 페이지에서 ${date} 지면 기사를 찾지 못했습니다(휴간이거나 페이지 구조 변경).`, articleCount: 0 } };
  }

  const articles = [];
  const problems = [];
  for (const item of listing) {
    const classified = classifyTitle(item.title);
    if (!classified) continue;
    await sleep(300);
    let detail;
    try {
      detail = parseArticlePage(await fetchHtml(item.naverUrl));
    } catch (error) {
      problems.push(`${item.title}: 기사 페이지 실패`);
      continue;
    }
    const original = detail.originalUrl?.replace(/^http:\/\//, 'https://');
    if (!original || !onDomain(original, publisher.domain)) {
      problems.push(`${item.title}: 언론사 원문 URL 없음`);
      continue;
    }
    const collectedAt = kstNow();
    const summary = await summarize(item.title, detail.text);
    articles.push({
      id: `${publisher.id}-${PRESS_CODES[publisher.id]}-${item.aid}`,
      publisherId: publisher.id,
      type: classified.type,
      title: item.title,
      url: original,
      naverUrl: item.naverUrl,
      naverUrlSource: 'naver_newspaper_page',
      page: item.page,
      publishedAt: detail.publishedAt,
      newspaperDate: date,
      newspaperEvidence: `네이버 신문보기 ${date} ${item.page ? `${item.page}면` : '지면'} 목록: ${pageUrl}`,
      collectedAt,
      summary: summary ?? '',
      summaryBasis: summary ? 'full_text' : 'metadata_only',
      classificationEvidence: classified.evidence,
    });
  }
  const note = [`지면 기사 ${listing.length}건 중 단독·기획 ${articles.length}건.`, ...problems].join(' ');
  return { articles, coverage: { publisherId: publisher.id, status: problems.length ? 'partial' : 'checked', note, articleCount: articles.length } };
}

const date = process.argv[2] || kstNow().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('사용법: node scripts/collect-naver.mjs [YYYY-MM-DD]');
  process.exit(1);
}

const { publishers } = JSON.parse(await readFile(archivePath, 'utf8'));
const results = [];
for (const publisher of publishers) {
  results.push(await collectPublisher(publisher, date));
  console.error(`${publisher.name}: ${results.at(-1).coverage.status}, ${results.at(-1).coverage.note}`);
}

const articles = results.flatMap((result) => result.articles);
const coverage = results.map((result) => result.coverage);
const allChecked = coverage.every((entry) => entry.status === 'checked');
const anyChecked = coverage.some((entry) => entry.status === 'checked' || entry.status === 'partial');
const generatedAt = kstNow();
const run = {
  date,
  generatedAt,
  windowStart: `${date}T00:00:00+09:00`,
  windowEnd: generatedAt,
  collectionMode: 'naver_newspaper',
  status: allChecked ? 'complete' : anyChecked ? 'partial' : 'failed',
  note: `네이버 신문보기 ${date}자 지면 목록을 GitHub Actions로 자동 수집. 단독은 제목의 [단독] 표기, 기획은 제목의 기획·연재 표기 기준.${process.env.GEMINI_API_KEY ? '' : ' 요약은 아직 연결하지 않았습니다.'}`,
  coverage,
  articles,
};
process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
if (!anyChecked) {
  console.error('모든 언론사 수집에 실패했습니다.');
  process.exitCode = 2;
}
