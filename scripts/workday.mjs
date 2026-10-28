// 예약 작업을 돌릴 날인지 확인한다. 주말·공휴일(config/holidays-kr.json)이면 건너뛴다.
//   node scripts/workday.mjs [YYYY-MM-DD]   → 출력: "run" 또는 "skip <이유>", 종료 코드: 실행 0 / 건너뜀 3
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const holidaysPath = fileURLToPath(new URL('../config/holidays-kr.json', import.meta.url));

export function kstToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
}

export function skipReason(date, holidays = JSON.parse(readFileSync(holidaysPath, 'utf8')).holidays) {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (weekday === 0 || weekday === 6) return weekday === 0 ? '일요일' : '토요일';
  return holidays[date] ?? null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const date = process.argv[2] || kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('사용법: node scripts/workday.mjs [YYYY-MM-DD]');
    process.exit(1);
  }
  const reason = skipReason(date);
  console.log(reason ? `skip ${reason}` : 'run');
  process.exitCode = reason ? 3 : 0;
}
