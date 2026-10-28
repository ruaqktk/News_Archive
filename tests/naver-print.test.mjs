import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTitle, parseArticlePage, parseNewspaperPage } from '../scripts/naver-print.mjs';

test('제목 표기로 단독·기획을 판정하고 칼럼·사설은 제외한다', () => {
  assert.equal(classifyTitle('[단독] 그린벨트 등급 재평가')?.type, 'exclusive');
  assert.equal(classifyTitle('〈단독〉 검찰, 압수수색')?.type, 'exclusive');
  assert.equal(classifyTitle('[기획] 저출산 20년의 기록')?.type, 'feature');
  assert.equal(classifyTitle('[창간기획] AI가 바꾼 일터')?.type, 'feature');
  assert.equal(classifyTitle('늙어가는 산업단지 ③ 떠나는 청년')?.type, 'feature');
  assert.equal(classifyTitle('반도체 전쟁 <2> 대만의 반격')?.type, 'feature');
  assert.equal(classifyTitle('단독주택 공급 늘린다'), null);
  assert.equal(classifyTitle('[사설] 연재 ① 같은 칼럼'), null);
  assert.equal(classifyTitle('코스피 2600 회복'), null);
});

test('지면 페이지에서 면 번호와 기사 링크를 순서대로 묶는다', () => {
  const html = `
    <div><h3><span><em>A1</em>면</span></h3>
      <ul><li><a href="https://n.news.naver.com/article/newspaper/009/0005753704?date=20261026"><div><strong>[단독] 그린벨트 등급 재평가</strong><p>요약</p></div></a></li></ul>
    </div>
    <div><h3><span><em>A3</em>면</span></h3>
      <ul><li><a href="https://n.news.naver.com/article/newspaper/009/0005753705?date=20261026"><strong>늙어가는 산단 ①</strong></a></li>
          <li><a href="https://n.news.naver.com/article/newspaper/009/0005753705?date=20261026">중복 링크</a></li>
          <li><a href="https://n.news.naver.com/article/newspaper/023/0000000001?date=20261026"><strong>다른 언론사</strong></a></li></ul>
    </div>`;
  const list = parseNewspaperPage(html, 'mk', '2026-10-26');
  assert.deepEqual(list.map((item) => [item.page, item.aid, item.title]), [
    ['A1', '0005753704', '[단독] 그린벨트 등급 재평가'],
    ['A3', '0005753705', '늙어가는 산단 ①'],
  ]);
  assert.equal(list[0].naverUrl, 'https://n.news.naver.com/article/newspaper/009/0005753704?date=20261026');
});

test('기사 페이지에서 원문 URL·발행시각·본문을 꺼낸다', () => {
  const html = `<span class="media_end_head_info_datestamp_time _ARTICLE_DATE_TIME" data-date-time="2026-10-25 17:39:00">2026.10.25.</span>
    <a href="https://www.mk.co.kr/news/realestate/12185262" class="media_end_head_origin_link" target="_blank">기사원문</a>
    <article id="dic_area" class="go_trans _article_content">정부가 그린벨트 &amp; 환경평가<br>등급을 재산정한다.</article>`;
  const parsed = parseArticlePage(html);
  assert.equal(parsed.originalUrl, 'https://www.mk.co.kr/news/realestate/12185262');
  assert.equal(parsed.publishedAt, '2026-10-25T17:39:00+09:00');
  assert.equal(parsed.text, '정부가 그린벨트 & 환경평가\n등급을 재산정한다.');
});

test('선택 결과로 만든 run은 아카이브 검증을 통과하고 원문 URL 없는 기사는 제외한다', async () => {
  const { buildRun } = await import('../scripts/build-run.mjs');
  const { validateRun, PUBLISHER_IDS } = await import('../scripts/archive-lib.mjs');
  const publishers = PUBLISHER_IDS.map((id) => ({ id, name: id, domain: id === 'mk' ? 'mk.co.kr' : `${id}.example`, url: id === 'mk' ? 'https://www.mk.co.kr/' : `https://${id}.example/` }));
  const listing = {
    date: '2026-10-28', scrapedAt: '2026-10-28T08:00:00+09:00',
    coverage: PUBLISHER_IDS.map((publisherId) => ({ publisherId, status: 'checked', note: '지면 기사 1건 수집.' })),
    articles: [
      { publisherId: 'mk', aid: '0005754872', page: 'A1', title: '[단독] 테스트', naverUrl: 'https://n.news.naver.com/article/newspaper/009/0005754872?date=20261028', originalUrl: 'https://www.mk.co.kr/news/economy/1', publishedAt: '2026-10-27T17:00:00+09:00', bodyLength: 100 },
      { publisherId: 'mk', aid: '0005754873', page: 'A2', title: '[단독] 원문 없음', naverUrl: 'https://n.news.naver.com/article/newspaper/009/0005754873?date=20261028', originalUrl: null, publishedAt: null, bodyLength: 0 },
    ],
  };
  const run = buildRun(listing, [
    { aid: '0005754872', publisherId: 'mk', type: 'exclusive', section: '경제', evidence: '제목 [단독]', summary: '요약입니다.' },
    { aid: '0005754873', publisherId: 'mk', type: 'exclusive', section: '경제', evidence: '제목 [단독]', summary: '' },
  ], publishers, '2026-10-28T09:05:00+09:00');
  assert.equal(run.articles.length, 1);
  assert.equal(run.coverage.find((entry) => entry.publisherId === 'mk').status, 'partial');
  validateRun(run, publishers);
  assert.throws(() => buildRun(listing, [{ aid: '999', publisherId: 'mk', type: 'feature', evidence: 'x' }], publishers, '2026-10-28T09:05:00+09:00'), /목록에 없는/);
});

test('분야 후보는 네이버 분류를 우선하고, 없으면 원문 주소 섹션을 쓴다', async () => {
  const { sectionHint, extractNaverSections } = await import('../scripts/naver-print.mjs');
  assert.deepEqual(extractNaverSections('<em class="media_end_categorize_item">IT/과학</em>'), ['IT/과학']);
  assert.deepEqual(sectionHint(['IT/과학'], 'https://www.chosun.com/politics/x'), { section: 'IT·과학', source: 'naver' });
  assert.deepEqual(sectionHint([], 'https://www.donga.com/news/Society/article/all/1/2'), { section: '사회', source: 'url' });
  assert.equal(sectionHint([], 'https://www.joongang.co.kr/article/1'), null);
});

test('주말·공휴일에는 예약 작업을 건너뛴다', async () => {
  const { skipReason } = await import('../scripts/workday.mjs');
  assert.equal(skipReason('2026-10-28'), null);
  assert.equal(skipReason('2026-10-31'), '토요일');
  assert.equal(skipReason('2026-11-01'), '일요일');
  assert.equal(skipReason('2026-12-25'), '성탄절');
  assert.equal(skipReason('2027-02-09'), '대체공휴일(설날)');
});
