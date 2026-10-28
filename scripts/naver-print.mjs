// 네이버 신문보기(지면) 페이지와 기사 페이지를 해석하는 순수 함수 모음.
// 네트워크 요청은 collect-naver.mjs가 담당하고, 이 파일은 테스트 가능한 파싱·분류만 맡는다.

export const PRESS_CODES = Object.freeze({
  chosun: '023',
  joongang: '025',
  donga: '020',
  hani: '028',
  hankookilbo: '469',
  khan: '032',
  kmib: '005',
  segye: '022',
  seoul: '081',
  sedaily: '011',
  mk: '009',
  hankyung: '015',
});

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function stripTags(html) {
  return decodeEntities(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function newspaperPageUrl(publisherId, date) {
  return `https://media.naver.com/press/${PRESS_CODES[publisherId]}/newspaper?date=${date.replaceAll('-', '')}`;
}

// 지면 페이지 HTML에서 [면 표기 → 기사 링크] 순서를 따라가며 기사 목록을 만든다.
// 네이버 마크업이 바뀌어도 버틸 수 있도록 특정 class 대신 "N면" 표기와 기사 URL 패턴만 사용한다.
export function parseNewspaperPage(html, publisherId, date) {
  const code = PRESS_CODES[publisherId];
  const compactDate = date.replaceAll('-', '');
  const tokens = [];
  const pageRe = /(?:<em[^>]*>\s*)?\b([A-Z]{0,2}\d{1,2})\s*(?:<\/em>\s*)?면(?![가-힣])/g;
  for (const match of html.matchAll(pageRe)) tokens.push({ index: match.index, page: match[1] });
  const linkRe = /<a\b[^>]*href=["']([^"']*n\.news\.naver\.com\/(?:mnews\/)?article\/(?:newspaper\/)?(\d{3})\/(\d{6,})[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkRe)) tokens.push({ index: match.index, link: match });
  tokens.sort((a, b) => a.index - b.index);

  const articles = new Map();
  let page = null;
  for (const token of tokens) {
    if (token.page) { page = token.page; continue; }
    const [, , oid, aid, inner] = token.link;
    if (oid !== code) continue;
    const strong = inner.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    const title = stripTags(strong ? strong[1] : inner).split('\n')[0].trim();
    if (!title || title.length < 4) continue;
    const existing = articles.get(aid);
    if (existing) { if (!existing.page && page) existing.page = page; continue; }
    articles.set(aid, {
      aid, page, title,
      naverUrl: `https://n.news.naver.com/article/newspaper/${code}/${aid}?date=${compactDate}`,
    });
  }
  return [...articles.values()];
}

const EXCLUDE = /[\[〈<【(]\s*(사설|칼럼|시론|포럼|기고|오피니언|인사|부고|게시판|알림|만평|독자|투데이\s*포토|포토|사진)/;
const EXCLUSIVE = /[\[〈<【(]\s*단독\s*[\]〉>】)]/;
const FEATURE_TAG = /[\[〈<【(]\s*([^\]〉>】)]*(기획|연재|시리즈|심층|탐사|르포|집중\s*점검|긴급\s*점검|창간)[^\]〉>】)]*)\s*[\]〉>】)]/;
const SERIES_NUMBER = /[①-⑳]|[\[〈<【(]\s*(\d{1,2}|[上中下]|상|중|하)\s*[\]〉>】)]\s*$|[\[〈<【(]\s*(\d{1,2}|[上中下])\s*[\]〉>】)]/;

// 제목만으로 단독·기획 여부를 판정한다. null이면 대상 아님.
export function classifyTitle(title) {
  if (EXCLUDE.test(title)) return null;
  if (EXCLUSIVE.test(title)) return { type: 'exclusive', evidence: '네이버 지면 제목의 [단독] 표기' };
  const tag = title.match(FEATURE_TAG);
  if (tag) return { type: 'feature', evidence: `네이버 지면 제목의 기획 표기(${tag[1].trim()})` };
  const series = title.match(SERIES_NUMBER);
  if (series) return { type: 'feature', evidence: `네이버 지면 제목의 연재 회차 표기(${series[0].trim()})` };
  return null;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
  return match ? decodeEntities(match[1]) : null;
}

// 기사 페이지에서 언론사 원문 URL, 최초 발행시각, 본문을 꺼낸다.
export function parseArticlePage(html) {
  let originalUrl = null;
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    if (/media_end_head_origin_link|기사원문/.test(match[0]) || /class=["'][^"']*origin_link/.test(match[0])) {
      originalUrl = attribute(match[0], 'href');
      if (originalUrl) break;
    }
  }
  if (!originalUrl) {
    const near = html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*기사원문/);
    if (near) originalUrl = decodeEntities(near[1]);
  }
  const dateAttr = html.match(/data-date-time=["'](\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})["']/);
  const publishedAt = dateAttr ? `${dateAttr[1].replace(' ', 'T')}+09:00` : null;
  const body = html.match(/<article[^>]*id=["']dic_area["'][^>]*>([\s\S]*?)<\/article>/i);
  const text = body ? stripTags(body[1].replace(/<(em|strong)[^>]*class=["']img_desc["'][\s\S]*?<\/\1>/gi, ' ')) : '';
  return { originalUrl, publishedAt, text, naverSections: extractNaverSections(html) };
}

// 네이버 기사 페이지의 분야 표시(예: "사회", "IT/과학")를 모은다. 마크업이 바뀔 수 있어 여러 신호를 본다.
export function extractNaverSections(html) {
  const found = new Set();
  for (const match of html.matchAll(/class=["'][^"']*media_end_categorize_item[^"']*["'][^>]*>([^<]{1,20})</g)) found.add(decodeEntities(match[1]).trim());
  for (const match of html.matchAll(/<meta[^>]+property=["'](?:article:section|me2:category2)["'][^>]+content=["']([^"']{1,20})["']/g)) found.add(decodeEntities(match[1]).trim());
  return [...found].filter(Boolean);
}

// 통일 분야: 네이버 뉴스 분류 기준
export const SECTIONS = Object.freeze(['정치', '경제', '사회', '생활·문화', '세계', 'IT·과학', '스포츠']);

const NAVER_SECTION_MAP = {
  '정치': '정치', '경제': '경제', '사회': '사회', '생활': '생활·문화', '문화': '생활·문화', '생활/문화': '생활·문화',
  '연예': '생활·문화', '세계': '세계', 'IT': 'IT·과학', '과학': 'IT·과학', 'IT/과학': 'IT·과학', '스포츠': '스포츠',
};

// 원문 주소의 섹션 경로 → 통일 분야
const URL_SECTION_RULES = [
  [/chosun\.com\/politics\//, '정치'], [/chosun\.com\/national\//, '사회'], [/chosun\.com\/economy\//, '경제'],
  [/chosun\.com\/international\//, '세계'], [/chosun\.com\/culture-life\//, '생활·문화'], [/chosun\.com\/sports\//, '스포츠'],
  [/donga\.com\/news\/Politics\//, '정치'], [/donga\.com\/news\/Society\//, '사회'], [/donga\.com\/news\/Economy\//, '경제'],
  [/donga\.com\/news\/Inter\//, '세계'], [/donga\.com\/news\/Culture\//, '생활·문화'], [/donga\.com\/news\/Sports\//, '스포츠'], [/donga\.com\/news\/It\//, 'IT·과학'],
  [/hani\.co\.kr\/arti\/politics\//, '정치'], [/hani\.co\.kr\/arti\/society\//, '사회'], [/hani\.co\.kr\/arti\/economy\//, '경제'],
  [/hani\.co\.kr\/arti\/international\//, '세계'], [/hani\.co\.kr\/arti\/culture\//, '생활·문화'], [/hani\.co\.kr\/arti\/sports\//, '스포츠'], [/hani\.co\.kr\/arti\/science\//, 'IT·과학'],
  [/mk\.co\.kr\/news\/politics\//, '정치'], [/mk\.co\.kr\/news\/(?:economy|business|realestate|stock)\//, '경제'], [/mk\.co\.kr\/news\/society\//, '사회'],
  [/mk\.co\.kr\/news\/world\//, '세계'], [/mk\.co\.kr\/news\/culture\//, '생활·문화'], [/mk\.co\.kr\/news\/it\//, 'IT·과학'], [/mk\.co\.kr\/news\/sports\//, '스포츠'],
  [/kmib\.co\.kr\/.*[?&]sid1=pol/, '정치'], [/kmib\.co\.kr\/.*[?&]sid1=eco/, '경제'], [/kmib\.co\.kr\/.*[?&]sid1=soc/, '사회'],
  [/kmib\.co\.kr\/.*[?&]sid1=int/, '세계'], [/kmib\.co\.kr\/.*[?&]sid1=cul/, '생활·문화'], [/kmib\.co\.kr\/.*[?&]sid1=spo/, '스포츠'],
];

// 분야 후보: 네이버 분류 1순위, 원문 주소 섹션 2순위. 못 찾으면 null(Claude가 기사 내용으로 정한다).
export function sectionHint(naverSections = [], originalUrl = '') {
  for (const name of naverSections) {
    const mapped = NAVER_SECTION_MAP[name.replace(/\s+/g, '')] ?? NAVER_SECTION_MAP[name];
    if (mapped) return { section: mapped, source: 'naver' };
  }
  for (const [pattern, section] of URL_SECTION_RULES) if (pattern.test(originalUrl || '')) return { section, source: 'url' };
  return null;
}

export function onDomain(value, domain) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

const BRACKET_TAG = /[\[〈<【]\s*[^\]〉>】]{1,30}\s*[\]〉>】]/;
const FEATURE_WORD = /단독|기획|르포|연재|탐사|심층|시리즈/;

// 기사 페이지(본문)를 열어 볼 후보인지 넓게 판정한다. 최종 판단은 Claude가 한다.
export function isCandidate(title) {
  if (EXCLUDE.test(title)) return false;
  return BRACKET_TAG.test(title) || SERIES_NUMBER.test(title) || FEATURE_WORD.test(title);
}
