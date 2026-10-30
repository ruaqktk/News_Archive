// 오늘 수집이 이미 끝났는지 확인한다(수집 워크플로가 중복 실행을 건너뛰는 데 쓴다).
//   node scripts/scrape-status.mjs <listing.json> <YYYY-MM-DD>
//   출력: "complete" | "incomplete <이유>" | "missing"
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function scrapeStatus(listing, date) {
  if (!listing) return { state: 'missing' };
  if (listing.date !== date) return { state: 'incomplete', reason: `날짜 불일치(${listing.date})` };
  const notChecked = listing.coverage.filter((entry) => entry.status !== 'checked').map((entry) => entry.publisherId);
  const failed = listing.articles.filter((article) => article.candidate && article.fetchError).length;
  if (notChecked.length || failed) {
    return { state: 'incomplete', reason: [notChecked.length ? `미완료 언론사 ${notChecked.join(',')}` : '', failed ? `기사 페이지 실패 ${failed}건` : ''].filter(Boolean).join(', ') };
  }
  return { state: 'complete' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, date] = process.argv.slice(2);
  let listing = null;
  try { listing = JSON.parse(readFileSync(file, 'utf8')); } catch { listing = null; }
  const result = scrapeStatus(listing, date);
  console.log(result.reason ? `${result.state} ${result.reason}` : result.state);
}
