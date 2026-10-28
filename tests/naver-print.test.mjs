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
