import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const PUBLISHER_IDS = Object.freeze([
  'chosun', 'joongang', 'donga', 'hani', 'hankookilbo', 'khan', 'kmib', 'segye', 'seoul', 'sedaily', 'mk', 'hankyung',
]);

const RUN_STATUSES = new Set(['complete', 'partial', 'failed']);
const COVERAGE_STATUSES = new Set(['checked', 'partial', 'blocked', 'not_checked']);
const ARTICLE_TYPES = new Set(['exclusive', 'feature']);
const SUMMARY_BASES = new Set(['full_text', 'partial_text', 'metadata_only']);
const PRESS_CODES = Object.freeze({ chosun:'023', joongang:'025', donga:'020', hani:'028', hankookilbo:'469', khan:'032', kmib:'005', segye:'022', seoul:'081', sedaily:'011', mk:'009', hankyung:'015' });

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value, label) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: 객체여야 합니다.`);
}

function string(value, label, allowEmpty = false) {
  requireCondition(typeof value === 'string' && (allowEmpty || value.trim().length > 0), `${label}: ${allowEmpty ? '문자열' : '비어 있지 않은 문자열'}이어야 합니다.`);
}

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function timestamp(value, label) {
  string(value, label);
  const parts = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/);
  requireCondition(parts && isCalendarDate(parts[1]), `${label}: 시간대가 포함된 유효한 ISO 날짜여야 합니다.`);
  requireCondition(Number(parts[2]) < 24 && Number(parts[3]) < 60 && Number(parts[4]) < 60, `${label}: 시각이 올바르지 않습니다.`);
  if (parts[5] !== 'Z') {
    const [hour, minute] = parts[5].slice(1).split(':').map(Number);
    requireCondition(hour <= 14 && minute < 60 && (hour !== 14 || minute === 0), `${label}: 시간대가 올바르지 않습니다.`);
  }
  requireCondition(Number.isFinite(Date.parse(value)), `${label}: 날짜를 해석할 수 없습니다.`);
  return Date.parse(value);
}

export function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

function officialUrl(value, domain, label) {
  string(value, label);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}: URL이 올바르지 않습니다.`); }
  requireCondition(url.protocol === 'https:' && !url.username && !url.password && !url.port, `${label}: 인증정보나 별도 포트 없는 HTTPS URL이어야 합니다.`);
  requireCondition(url.hostname === domain || url.hostname.endsWith(`.${domain}`), `${label}: ${domain} 공식 도메인 밖의 URL입니다.`);
}

export function validatePublishers(publishers) {
  requireCondition(Array.isArray(publishers) && publishers.length === PUBLISHER_IDS.length, `publishers: 지정한 ${PUBLISHER_IDS.length}개 언론사가 필요합니다.`);
  const ids = new Set();
  for (const publisher of publishers) {
    record(publisher, 'publisher');
    requireCondition(PUBLISHER_IDS.includes(publisher.id) && !ids.has(publisher.id), `publisher.id: 알 수 없거나 중복된 언론사(${publisher.id})입니다.`);
    ids.add(publisher.id);
    string(publisher.name, `${publisher.id}.name`);
    string(publisher.domain, `${publisher.id}.domain`);
    requireCondition(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(publisher.domain), `${publisher.id}.domain: 소문자 도메인만 사용하세요.`);
    officialUrl(publisher.url, publisher.domain, `${publisher.id}.url`);
  }
  return new Map(publishers.map((publisher) => [publisher.id, publisher]));
}

export function validateRun(run, publishers) {
  const publisherMap = validatePublishers(publishers);
  record(run, 'run');
  requireCondition(isCalendarDate(run.date), 'run.date: 실제 존재하는 YYYY-MM-DD 날짜여야 합니다.');
  const generated = timestamp(run.generatedAt, 'run.generatedAt');
  const start = timestamp(run.windowStart, 'run.windowStart');
  const end = timestamp(run.windowEnd, 'run.windowEnd');
  requireCondition(start <= end, 'run: 수집 시작이 종료보다 늦습니다.');
  requireCondition(generated >= end, 'run.generatedAt: 수집 종료 시각보다 빠를 수 없습니다.');
  requireCondition(RUN_STATUSES.has(run.status), 'run.status: complete, partial, failed 중 하나여야 합니다.');
  if (run.note !== undefined) string(run.note, 'run.note', true);
  requireCondition(Array.isArray(run.articles), 'run.articles: 배열이어야 합니다.');

  const isPrint = run.collectionMode === 'naver_newspaper';
  if (run.collectionMode !== undefined) requireCondition(isPrint, '지원되지 않는 수집 방식입니다.');
  const urls = new Set();
  const ids = new Set();
  const counts = new Map(PUBLISHER_IDS.map((id) => [id, 0]));
  for (const [index, article] of run.articles.entries()) {
    const label = `articles[${index}]`;
    record(article, label);
    string(article.id, `${label}.id`);
    requireCondition(!ids.has(article.id), `${label}: 중복 기사 ID입니다.`);
    ids.add(article.id);
    const publisher = publisherMap.get(article.publisherId);
    requireCondition(publisher, `${label}: 지정하지 않은 언론사입니다.`);
    requireCondition(ARTICLE_TYPES.has(article.type), `${label}.type: exclusive 또는 feature여야 합니다.`);
    string(article.title, `${label}.title`);
    officialUrl(article.url, publisher.domain, `${label}.url`);
    if (isPrint) {
      requireCondition(article.newspaperDate === run.date, `${label}.newspaperDate: 지면 날짜가 일치하지 않습니다.`);
      string(article.newspaperEvidence, `${label}.newspaperEvidence`);
      if (article.naverUrl != null) {
        string(article.naverUrl, `${label}.naverUrl`);
        let naver;
        try { naver = new URL(article.naverUrl); } catch { throw new Error(`${label}.naverUrl: 잘못된 주소입니다.`); }
        const code = PRESS_CODES[article.publisherId];
        const path = naver.pathname;
        const isNews = path.startsWith(`/mnews/article/${code}/`) && /^\/mnews\/article\/\d{3}\/\d+\/?$/.test(path);
        const isNewspaper = path.startsWith(`/article/newspaper/${code}/`) && /^\/article\/newspaper\/\d{3}\/\d+\/?$/.test(path) && naver.searchParams.get('date') === run.date.replaceAll('-', '');
        requireCondition(naver.protocol === 'https:' && naver.hostname === 'n.news.naver.com' && !naver.username && !naver.password && !naver.port && (isNews || isNewspaper), `${label}.naverUrl: 유효한 네이버 개별 기사 주소가 아닙니다.`);
      }
    }
    const url = canonicalUrl(article.url);
    requireCondition(!urls.has(url), `${label}: 동일한 기사 URL이 중복되었습니다.`);
    urls.add(url);
    requireCondition(article.publishedAt === null || typeof article.publishedAt === 'string', `${label}.publishedAt: ISO 날짜 또는 null이어야 합니다.`);
    const collected = timestamp(article.collectedAt, `${label}.collectedAt`);
    requireCondition(collected <= generated, `${label}.collectedAt: 브리핑 생성 시각보다 늦을 수 없습니다.`);
    if (article.publishedAt !== null) {
      const published = timestamp(article.publishedAt, `${label}.publishedAt`);
      if (!isPrint) requireCondition(published >= start && published < end, `${label}.publishedAt: 수집 범위 밖의 기사입니다.`);
      requireCondition(published <= collected, `${label}.publishedAt: 기사 확인 시각보다 늦을 수 없습니다.`);
    }
    requireCondition(SUMMARY_BASES.has(article.summaryBasis), `${label}.summaryBasis: 확인 범위가 올바르지 않습니다.`);
    string(article.summary, `${label}.summary`, article.summaryBasis === 'metadata_only');
    string(article.classificationEvidence, `${label}.classificationEvidence`);
    counts.set(article.publisherId, counts.get(article.publisherId) + 1);
  }

  requireCondition(Array.isArray(run.coverage) && run.coverage.length === PUBLISHER_IDS.length, `run.coverage: ${PUBLISHER_IDS.length}개 언론사의 확인 상태가 필요합니다.`);
  const covered = new Set();
  for (const entry of run.coverage) {
    record(entry, 'coverage');
    requireCondition(publisherMap.has(entry.publisherId) && !covered.has(entry.publisherId), 'coverage: 알 수 없거나 중복된 언론사입니다.');
    covered.add(entry.publisherId);
    requireCondition(COVERAGE_STATUSES.has(entry.status), `${entry.publisherId}.coverage: 상태가 올바르지 않습니다.`);
    string(entry.note, `${entry.publisherId}.coverage.note`, true);
    requireCondition(Number.isInteger(entry.articleCount) && entry.articleCount === counts.get(entry.publisherId), `${entry.publisherId}.coverage.articleCount: 실제 기사 수와 다릅니다.`);
    if (['blocked', 'not_checked'].includes(entry.status) && entry.articleCount > 0) {
      requireCondition(entry.note.trim().length > 0, `${entry.publisherId}.coverage.note: 이전 기사가 보존된 이유를 적어 주세요.`);
    }
  }
  requireCondition(run.status !== 'complete' || run.coverage.every((entry) => entry.status === 'checked'), 'run.status: 모든 언론사를 확인한 경우에만 complete를 사용할 수 있습니다.');
  return run;
}

export function validateArchive(archive) {
  record(archive, 'archive');
  requireCondition(archive.schemaVersion === 1, 'schemaVersion: 1이어야 합니다.');
  requireCondition(archive.timezone === 'Asia/Seoul', 'timezone: Asia/Seoul이어야 합니다.');
  validatePublishers(archive.publishers);
  requireCondition(Array.isArray(archive.runs), 'runs: 배열이어야 합니다.');
  if (archive.updatedAt !== null) timestamp(archive.updatedAt, 'updatedAt');
  requireCondition(archive.runs.length === 0 || archive.updatedAt !== null, 'updatedAt: 저장된 기사가 있는 아카이브는 갱신 시각이 필요합니다.');
  const dates = new Set();
  for (const run of archive.runs) {
    validateRun(run, archive.publishers);
    requireCondition(!dates.has(run.date), `runs: ${run.date} 날짜가 중복되었습니다.`);
    dates.add(run.date);
  }
  return archive;
}

function recountedCoverage(coverage, articles) {
  return coverage.map((entry) => {
    const articleCount = articles.filter((article) => article.publisherId === entry.publisherId).length;
    let note = entry.note;
    if (['blocked', 'not_checked'].includes(entry.status) && articleCount > 0) {
      const preservation = '이전에 확인해 저장한 기사는 보존했습니다.';
      if (!note.includes(preservation)) note = `${note} ${preservation}`.trim();
    }
    return { ...entry, note, articleCount };
  });
}

export function mergeRun(archive, incoming) {
  validateArchive(archive);
  validateRun(incoming, archive.publishers);
  const existing = archive.runs.find((run) => run.date === incoming.date);
  const elsewhere = new Set(archive.runs.filter((run) => run.date !== incoming.date).flatMap((run) => run.articles.map((article) => canonicalUrl(article.url))));
  const articleMap = new Map((existing?.articles ?? []).map((article) => [canonicalUrl(article.url), structuredClone(article)]));
  const incomingIsLatest = !existing || Date.parse(incoming.generatedAt) >= Date.parse(existing.generatedAt);
  let added = 0;
  let updated = 0;
  let skippedPreviouslyArchived = 0;
  for (const article of incoming.articles) {
    const url = canonicalUrl(article.url);
    if (elsewhere.has(url) && !articleMap.has(url) && incoming.collectionMode !== 'naver_newspaper') { skippedPreviouslyArchived += 1; continue; }
    const normalized = { ...structuredClone(article), url };
    if (!articleMap.has(url)) { articleMap.set(url, normalized); added += 1; }
    else if (incomingIsLatest && JSON.stringify(articleMap.get(url)) !== JSON.stringify(normalized)) {
      articleMap.set(url, normalized);
      updated += 1;
    }
  }

  const latest = incomingIsLatest ? incoming : existing;
  const merged = structuredClone(latest);
  merged.articles = [...articleMap.values()];
  if (existing) {
    merged.windowStart = Date.parse(existing.windowStart) < Date.parse(incoming.windowStart) ? existing.windowStart : incoming.windowStart;
    merged.windowEnd = Date.parse(existing.windowEnd) > Date.parse(incoming.windowEnd) ? existing.windowEnd : incoming.windowEnd;
    const latestCoversMergedWindow = Date.parse(latest.windowStart) <= Date.parse(merged.windowStart) && Date.parse(latest.windowEnd) >= Date.parse(merged.windowEnd);
    if (merged.status === 'complete' && !latestCoversMergedWindow && existing.status !== 'complete') merged.status = 'partial';
    if (merged.status === 'failed' && merged.articles.length > 0) {
      merged.status = 'partial';
      merged.note = [merged.note, '최근 수집에 실패해 이전에 확인한 기사를 보존했습니다.'].filter(Boolean).join(' ');
    }
  }
  merged.coverage = recountedCoverage(merged.coverage, merged.articles);
  const runs = archive.runs.map((run) => run.date === merged.date ? merged : structuredClone(run));
  if (!existing) runs.push(merged);
  runs.sort((a, b) => b.date.localeCompare(a.date));
  const timestamps = [archive.updatedAt, ...runs.map((run) => run.generatedAt)].filter(Boolean);
  const updatedAt = timestamps.reduce((latestTime, time) => Date.parse(time) > Date.parse(latestTime) ? time : latestTime);
  const result = { ...structuredClone(archive), updatedAt, runs };
  validateArchive(result);
  return { archive: result, stats: { date: incoming.date, added, updated, skippedPreviouslyArchived, articleCount: merged.articles.length } };
}

export async function readArchive(file) {
  const archive = JSON.parse(await readFile(file, 'utf8'));
  return validateArchive(archive);
}

export async function mergeRunFile(archivePath, incomingPath) {
  const archive = await readArchive(archivePath);
  const incoming = JSON.parse(await readFile(incomingPath, 'utf8'));
  const result = mergeRun(archive, incoming);
  const content = `${JSON.stringify(result.archive, null, 2)}\n`;
  if (content === await readFile(archivePath, 'utf8')) return { ...result.stats, changed: false };
  const temporaryPath = `${archivePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { flag: 'wx' });
    await rename(temporaryPath, archivePath);
  } finally {
    await unlink(temporaryPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  return { ...result.stats, changed: true };
}
