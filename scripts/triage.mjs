// 제목만으로 단독·기획 여부를 1차 판정한다.
//   node scripts/triage.mjs <listing.json>                 → 자동 판정 요약 + 검토가 필요한 기사 목록
//   node scripts/triage.mjs <listing.json> --selections    → 자동 선정분으로 selections 초안(JSON) 출력
// 규칙은 config/classification-rules.json, 설명은 docs/CLASSIFICATION.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rulesPath = fileURLToPath(new URL('../config/classification-rules.json', import.meta.url));

export function loadRules(path = rulesPath) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const TAG_RE = /\[([^\]]{1,60})\]|〈([^〉]{1,60})〉|<([^>]{1,60})>|【([^】]{1,60})】/g;
const NUMBER_ONLY = /^\s*(\d{1,3}|[上中下]|상|중|하)\s*$/;
const CIRCLED = /[①-⑳]/;

// 제목에서 괄호 문패를 뽑는다. 숫자만 든 괄호는 연재 번호로 따로 표시한다.
export function extractTags(title) {
  const tags = [];
  let seriesNumber = CIRCLED.test(title);
  for (const match of title.matchAll(TAG_RE)) {
    const text = (match[1] ?? match[2] ?? match[3] ?? match[4]).trim();
    if (NUMBER_ONLY.test(text)) { seriesNumber = true; continue; }
    // "[글로벌 현장을 가다/신진우]" 처럼 필자명이 붙은 문패는 앞부분만 본다.
    tags.push(text.split('/')[0].trim());
  }
  return { tags, seriesNumber };
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const containsWord = (tag, words) => words.find((word) => tag.includes(word));

function registryMatch(registry, tag) {
  if (!registry) return null;
  const key = normalize(tag);
  for (const [name, entry] of Object.entries(registry)) {
    const registered = normalize(name);
    if (key === registered || key.startsWith(`${registered}-`)) return { name, ...entry };
  }
  return null;
}

// 판정: exclusive | feature | exclude | review, 근거(rule)와 함께 돌려준다.
export function triageTitle(title, publisherId, rules) {
  const { tags, seriesNumber } = extractTags(title);
  const exclusiveTag = tags.find((tag) => rules.exclusiveTags.includes(normalize(tag)));
  const featureFromTags = () => {
    for (const tag of tags) {
      const registered = registryMatch(rules.seriesRegistry[publisherId], tag);
      if (registered?.decision === 'feature') return `연재 등록부: [${registered.name}] ${registered.note ?? ''}`.trim();
      const word = containsWord(tag, rules.featureTagWords);
      if (word && !containsWord(tag, rules.excludeTagWords)) return `제목의 기획 문패 [${tag}]`;
    }
    return null;
  };
  if (exclusiveTag) {
    const feature = featureFromTags();
    return { decision: 'exclusive', rule: `제목의 [${exclusiveTag}] 표기${feature ? `, ${feature}` : ''}`, tags };
  }
  const personal = new RegExp(rules.personalColumnPattern);
  let unknown = null;
  for (const tag of tags.filter((item) => !rules.exclusiveTags.includes(normalize(item)))) {
    const registered = registryMatch(rules.seriesRegistry[publisherId], tag);
    if (registered) {
      return registered.decision === 'feature'
        ? { decision: 'feature', rule: `연재 등록부: [${registered.name}] ${registered.note ?? ''}`.trim(), tags }
        : { decision: 'exclude', rule: `연재 등록부 제외: [${registered.name}] ${registered.note ?? ''}`.trim(), tags };
    }
    const excludeWord = (rules.excludeTagExact ?? []).find((word) => normalize(tag) === word) ?? containsWord(tag, rules.excludeTagWords);
    if (excludeWord) return { decision: 'exclude', rule: `제외 문패 [${tag}] (${excludeWord})`, tags };
    const featureWord = containsWord(tag, rules.featureTagWords);
    if (featureWord) return { decision: 'feature', rule: `제목의 기획 문패 [${tag}]`, tags };
    if (personal.test(tag)) return { decision: 'exclude', rule: `개인 칼럼 문패 [${tag}]`, tags };
    unknown ??= tag;
  }
  if (unknown) return { decision: 'review', rule: `미등록 문패 [${unknown}]${seriesNumber ? ' + 연재 번호' : ''}`, tags };
  if (seriesNumber) return { decision: 'review', rule: '문패 없는 연재 번호', tags };
  return { decision: 'exclude', rule: '문패·연재 표기 없음', tags };
}

export function triageListing(listing, rules) {
  return listing.articles.map((article) => ({ ...article, ...triageTitle(article.title, article.publisherId, rules) }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, flag] = process.argv.slice(2);
  if (!file) {
    console.error('사용법: node scripts/triage.mjs <listing.json> [--selections]');
    process.exit(1);
  }
  const listing = JSON.parse(readFileSync(file, 'utf8'));
  const rows = triageListing(listing, loadRules());
  if (flag === '--selections') {
    const picked = rows.filter((row) => row.decision === 'exclusive' || row.decision === 'feature');
    process.stdout.write(`${JSON.stringify(picked.map((row) => ({ publisherId: row.publisherId, aid: row.aid, type: row.decision, evidence: row.rule, summary: '', detail: null })), null, 2)}\n`);
  } else {
    const count = (decision) => rows.filter((row) => row.decision === decision).length;
    console.log(`# ${listing.date} 지면 ${rows.length}건 — 자동 단독 ${count('exclusive')}, 자동 기획 ${count('feature')}, 검토 ${count('review')}, 제외 ${count('exclude')}`);
    for (const decision of ['exclusive', 'feature', 'review']) {
      console.log(`\n## ${{ exclusive: '자동 단독', feature: '자동 기획', review: '검토 필요 (Claude 판단 후 연재 등록부에 기록)' }[decision]}`);
      for (const row of rows.filter((item) => item.decision === decision)) {
        console.log([row.publisherId, row.page ?? '-', row.aid, row.title, `← ${row.rule}`, row.bodyLength ? '' : '(본문 없음)'].filter(Boolean).join(' | '));
      }
    }
  }
}
