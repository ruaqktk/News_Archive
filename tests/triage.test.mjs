import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTags, loadRules, triageTitle } from '../scripts/triage.mjs';

const rules = loadRules();
const decide = (title, publisher = 'segye') => triageTitle(title, publisher, rules).decision;

test('괄호 문패와 연재 번호를 구분해 뽑는다', () => {
  assert.deepEqual(extractTags('[글로벌 현장을 가다/신진우]100년 역사 골프장'), { tags: ['글로벌 현장을 가다'], seriesNumber: false });
  assert.deepEqual(extractTags('기억, 살아있다는 것[정덕현의 그 영화 이 대사]〈130〉'), { tags: ['정덕현의 그 영화 이 대사'], seriesNumber: true });
  assert.equal(extractTags('늙어가는 산단 ③ 떠나는 청년').seriesNumber, true);
});

test('제목 규칙: 단독·기획은 자동 선정, 칼럼·사진·운세는 자동 제외', () => {
  assert.equal(decide('[단독] 그린벨트 등급 재평가'), 'exclusive');
  assert.equal(decide('[단독] 임시조치 만료 [심층기획-가장 가까운 가해자]'), 'exclusive');
  assert.equal(decide('제작·유통 슈퍼 갑 [심층기획-넷플릭스 상륙 10년]'), 'feature');
  assert.equal(decide('[르포] 동탄 묶자 병점 뛰었다', 'kmib'), 'feature');
  assert.equal(decide('국정 난맥상 커진다 [이해충돌에 길 잃은 국가정책]'), 'feature');
  assert.equal(decide('[조수빈의 말로 사람 읽기] [12] 장미 한 송이', 'chosun'), 'exclude');
  assert.equal(decide('[김상미의감성엽서] 이야기의 힘'), 'exclude');
  assert.equal(decide('[사설] 연재 ① 같은 사설', 'chosun'), 'exclude');
  assert.equal(decide('[포토] 한방거리 찾은 외국인', 'hankyung'), 'exclude');
  assert.equal(decide('[오늘의 운세/10월 28일]', 'donga'), 'exclude');
  assert.equal(decide('[스마트산업강국 함께 하는 제조혁신 4.0] 불량 15% 뚝', 'mk'), 'exclude');
  assert.equal(decide('단독주택 공급 늘린다'), 'exclude');
  assert.equal(decide('코스피 2600 회복'), 'exclude');
});

test('처음 보는 문패와 문패 없는 연재 번호는 검토로 넘긴다', () => {
  assert.equal(decide('[새로운 연중 문패] 무엇인가'), 'review');
  assert.equal(decide('늙어가는 산업단지 ③ 떠나는 청년'), 'review');
});

test('연재 등록부는 문패가 정확히 같을 때만 적용한다', () => {
  assert.equal(decide('네타냐후 기로[이스라엘 총선 현장 르포]', 'khan'), 'feature');
  assert.equal(decide('트럼프, 네타냐후 지지[이스라엘 총선]', 'khan'), 'exclude');
});
