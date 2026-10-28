import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalUrl, mergeRun, mergeRunFile, PUBLISHER_IDS, validateRun } from '../scripts/archive-lib.mjs';

const publishers = PUBLISHER_IDS.map((id) => ({ id, name: id, domain: `${id}.example`, url: `https://${id}.example/` }));

function article(slug, date = '2026-10-26') {
  return {
    id: slug, publisherId: 'mk', type: 'exclusive', title: `[단독] 테스트 ${slug}`,
    url: `https://mk.example/news/${slug}`, publishedAt: `${date}T08:00:00+09:00`,
    collectedAt: `${date}T09:05:00+09:00`, summary: '검증용 데이터입니다.',
    summaryBasis: 'full_text', classificationEvidence: '제목의 [단독] 표시',
  };
}

function run(date, articles = []) {
  return {
    date, generatedAt: `${date}T09:05:00+09:00`, windowStart: `${date}T00:00:00+09:00`,
    windowEnd: `${date}T09:00:00+09:00`, status: 'complete', articles,
    coverage: PUBLISHER_IDS.map((publisherId) => ({ publisherId, status: 'checked', note: '', articleCount: articles.filter((item) => item.publisherId === publisherId).length })),
  };
}

function archive(runs = []) {
  return { schemaVersion: 1, timezone: 'Asia/Seoul', updatedAt: runs.at(-1)?.generatedAt ?? null, publishers, runs };
}

test('재실행은 추적 URL을 중복 저장하지 않고 기존 날짜를 보존한다', () => {
  const old = run('2026-10-25', [article('old', '2026-10-25')]);
  const incoming = run('2026-10-26', [article('new')]);
  incoming.articles[0].url += '?utm_source=news#section';
  const first = mergeRun(archive([old]), incoming);
  const second = mergeRun(first.archive, incoming);
  assert.equal(second.stats.added, 0);
  assert.equal(second.stats.updated, 0);
  assert.deepEqual(second.archive, first.archive);
  assert.deepEqual(second.archive.runs.find((item) => item.date === old.date), old);
  assert.equal(second.archive.runs[0].articles[0].url, 'https://mk.example/news/new');
});

test('이전 날짜에 보관된 동일 기사는 신규 브리핑에서 제외하고 집계를 다시 계산한다', () => {
  const old = run('2026-10-25', [article('old', '2026-10-25')]);
  const incoming = run('2026-10-26', [article('old'), article('new')]);
  const result = mergeRun(archive([old]), incoming);
  assert.equal(result.stats.skippedPreviouslyArchived, 1);
  assert.deepEqual(result.archive.runs[0].articles.map((item) => item.id), ['new']);
  assert.equal(result.archive.runs[0].coverage.find((entry) => entry.publisherId === 'mk').articleCount, 1);
  assert.deepEqual(result.archive.runs[1], old);
});

test('같은 날짜 병합은 기존 기사와 넓은 수집 구간을 유지하고 오래된 결과로 덮어쓰지 않는다', () => {
  const existing = run('2026-10-26', [article('one')]);
  existing.windowStart = '2026-10-25T09:00:00+09:00';
  existing.generatedAt = '2026-10-26T10:05:00+09:00';
  const incoming = run('2026-10-26', [article('one'), article('two')]);
  incoming.articles[0].summary = '오래된 내용';
  const result = mergeRun(archive([existing]), incoming);
  assert.equal(result.archive.runs[0].articles.length, 2);
  assert.equal(result.archive.runs[0].articles[0].summary, existing.articles[0].summary);
  assert.equal(result.archive.runs[0].generatedAt, existing.generatedAt);
  assert.equal(result.archive.runs[0].windowStart, existing.windowStart);
});

test('수집 실패 후에도 기존 기사를 보존하고 부분 확인으로 표시한다', () => {
  const existing = run('2026-10-26', [article('one')]);
  const incoming = run('2026-10-26');
  incoming.generatedAt = '2026-10-26T10:05:00+09:00';
  incoming.status = 'failed';
  incoming.coverage.forEach((item) => { item.status = 'blocked'; });
  const result = mergeRun(archive([existing]), incoming);
  assert.equal(result.archive.runs[0].articles.length, 1);
  assert.equal(result.archive.runs[0].status, 'partial');
  assert.match(result.archive.runs[0].coverage.find((entry) => entry.publisherId === 'mk').note, /보존/);
});

test('정규화는 기사 식별 쿼리는 유지하고 알려진 추적 파라미터만 제거한다', () => {
  assert.equal(canonicalUrl('https://mk.example/read?aid=42&utm_source=test&gclid=x#top'), 'https://mk.example/read?aid=42');
  assert.equal(canonicalUrl('https://mk.example/read?aid=43'), 'https://mk.example/read?aid=43');
});

test('잘못된 도메인·날짜·유형·확인 상태는 거부하고 저장 파일을 바꾸지 않는다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'news-archive-test-'));
  const archivePath = join(directory, 'archive.json');
  const incomingPath = join(directory, 'run.json');
  const original = `${JSON.stringify(archive(), null, 2)}\n`;
  await writeFile(archivePath, original);
  const candidates = [];
  const external = run('2026-10-26', [article('one')]);
  external.articles[0].url = 'https://mk.example.attacker.invalid/article';
  candidates.push(external);
  const impossible = run('2026-02-30');
  candidates.push(impossible);
  const unsupported = run('2026-10-26', [article('one')]);
  unsupported.articles[0].type = 'ordinary';
  candidates.push(unsupported);
  const dishonestComplete = run('2026-10-26');
  dishonestComplete.coverage.find((entry) => entry.publisherId === 'mk').status = 'not_checked';
  candidates.push(dishonestComplete);
  for (const publishedAt of ['2026-10-25T23:59:59+09:00', '2026-10-26T09:00:00+09:00', '2026-10-27T08:00:00+09:00']) {
    const outsideWindow = run('2026-10-26', [article('one')]);
    outsideWindow.articles[0].publishedAt = publishedAt;
    candidates.push(outsideWindow);
  }
  const beforePublication = run('2026-10-26', [article('one')]);
  beforePublication.articles[0].collectedAt = '2026-10-26T07:59:59+09:00';
  candidates.push(beforePublication);
  const futureCollection = run('2026-10-26', [article('one')]);
  futureCollection.articles[0].collectedAt = '2026-10-26T09:05:01+09:00';
  candidates.push(futureCollection);
  const beforeWindowEnd = run('2026-10-26');
  beforeWindowEnd.generatedAt = '2026-10-26T08:59:59+09:00';
  candidates.push(beforeWindowEnd);
  try {
    for (const candidate of candidates) {
      await writeFile(incomingPath, JSON.stringify(candidate));
      await assert.rejects(mergeRunFile(archivePath, incomingPath));
      assert.equal(await readFile(archivePath, 'utf8'), original);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('본문 확인 범위와 언론사별 기사 수가 일치해야 한다', () => {
  const candidate = run('2026-10-26', [article('one')]);
  candidate.coverage.find((entry) => entry.publisherId === 'mk').articleCount = 0;
  assert.throws(() => validateRun(candidate, publishers), /실제 기사 수/);
  candidate.coverage.find((entry) => entry.publisherId === 'mk').articleCount = 1;
  candidate.articles[0].publishedAt = '2026-10-26T08:00:00';
  assert.throws(() => validateRun(candidate, publishers), /시간대/);
});


test('지면 기사는 온라인 발행일과 지면 날짜가 달라도 허용한다', () => {
  const candidate = run('2026-10-26', [article('print')]);
  candidate.collectionMode = 'naver_newspaper';
  candidate.articles[0].publishedAt = '2026-10-25T08:00:00+09:00';
  candidate.articles[0].newspaperDate = '2026-10-26';
  candidate.articles[0].newspaperEvidence = '네이버 신문보기 2026-10-26 지면에서 확인';
  candidate.articles[0].naverUrl = 'https://n.news.naver.com/mnews/article/009/1234567890';
  assert.doesNotThrow(() => validateRun(candidate, publishers));
  candidate.articles[0].naverUrl = 'https://media.naver.com/press/009/newspaper';
  assert.throws(() => validateRun(candidate, publishers), /네이버 개별 기사/);
  candidate.articles[0].naverUrl = 'https://n.news.naver.com/mnews/article/023/1234567890';
  assert.throws(() => validateRun(candidate, publishers), /네이버 개별 기사/);
});
