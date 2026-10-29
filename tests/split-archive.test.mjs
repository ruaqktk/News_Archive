import test from 'node:test';
import assert from 'node:assert/strict';
import { splitArchive } from '../scripts/split-archive.mjs';

const article = (id, date, type, detail) => ({ id, publisherId: 'mk', type, section: '경제', page: 'A1', title: `제목 ${id}`, summary: `요약 ${id}`, url: 'https://www.mk.co.kr/x', detail, newspaperDate: date });

test('원본을 작은 목록, 날짜별 지면, 월별 검색 파일로 나눈다', () => {
  const archive = {
    schemaVersion: 1, timezone: 'Asia/Seoul', updatedAt: '2026-11-02T09:00:00+09:00',
    publishers: [{ id: 'mk', name: '매일경제' }],
    runs: [
      { date: '2026-10-30', articles: [article('a', '2026-10-30', 'exclusive', { background: '배경', points: ['하나', '둘'], significance: '의미', terms: [{ term: 'LTA', description: '장기계약' }] })], coverage: [] },
      { date: '2026-11-02', articles: [article('b', '2026-11-02', 'feature', null), article('c', '2026-11-02', 'exclusive', null)], coverage: [] },
    ],
  };
  const { index, days, search } = splitArchive(archive);
  assert.deepEqual(index.dates.map((d) => [d.date, d.total, d.exclusive, d.feature]), [['2026-11-02', 2, 1, 1], ['2026-10-30', 1, 1, 0]]);
  assert.deepEqual(index.months, ['2026-11', '2026-10']);
  assert.equal(JSON.stringify(index).includes('요약'), false, '목록 파일에는 기사 본문 요약이 들어가지 않는다');
  assert.equal(days.get('2026-10-30').articles[0].detail.background, '배경');
  assert.deepEqual(search.get('2026-10')[0].pieces, ['배경', '하나', '둘', '의미', 'LTA: 장기계약']);
  assert.equal(search.get('2026-11').length, 2);
  assert.equal('url' in search.get('2026-11')[0], false, '검색 파일은 필요한 필드만 담는다');
});
