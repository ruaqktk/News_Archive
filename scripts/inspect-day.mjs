// Claude 예약 작업이 하루치 수집 결과를 훑어볼 때 쓰는 보조 도구.
//   node scripts/inspect-day.mjs titles <listing.json>            → 언론사·면·aid·힌트·제목 한 줄씩
//   node scripts/inspect-day.mjs bodies <bodies.jsonl> <aid>...    → 지정한 기사 본문
import { readFile } from 'node:fs/promises';

const [mode, file, ...rest] = process.argv.slice(2);
if (mode === 'titles') {
  const listing = JSON.parse(await readFile(file, 'utf8'));
  console.log(`# ${listing.date} 지면 기사 ${listing.articles.length}건 (형식: 언론사 | 면 | aid | 제목기반 힌트 | 제목)`);
  for (const coverage of listing.coverage) console.log(`# ${coverage.publisherId}: ${coverage.status} — ${coverage.note}`);
  for (const article of listing.articles) {
    console.log([article.publisherId, article.page ?? '-', article.aid, article.titleHint ?? '-', article.title].join(' | '));
  }
} else if (mode === 'bodies') {
  const wanted = new Set(rest);
  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  for (const line of lines) {
    const body = JSON.parse(line);
    if (wanted.size && !wanted.has(body.aid)) continue;
    console.log(`=== ${body.publisherId} ${body.aid} ===\n${body.text}\n`);
  }
} else {
  console.error('사용법: inspect-day.mjs titles <listing.json> | bodies <bodies.jsonl> <aid>...');
  process.exitCode = 1;
}
