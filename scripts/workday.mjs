// 예약 작업을 돌릴 날인지 확인한다. 주말·공휴일(config/holidays-kr.json)이면 건너뛴다.
//   node scripts/workday.mjs [YYYY-MM-DD]          → 출력: "run" 또는 "skip <이유>", 종료 코드: 실행 0 / 건너뜀 3
//   node scripts/workday.mjs --prev [YYYY-MM-DD]   → 그 전 평일(공휴일 제외) 날짜 출력
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

// 주어진 날짜 바로 앞의 평일(공휴일 제외).
export function previousWorkday(date, holidays) {
  const [y, m, d] = date.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 30; i += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const candidate = cursor.toISOString().slice(0, 10);
    if (!skipReason(candidate, holidays)) return candidate;
  }
  throw new Error('30일 안에 평일이 없습니다.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prev = process.argv[2] === '--prev';
  const date = process.argv[prev ? 3 : 2] || kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('사용법: node scripts/workday.mjs [--prev] [YYYY-MM-DD]');
    process.exit(1);
  }
  if (prev) {
    console.log(previousWorkday(date));
    process.exit(0);
  }
  const reason = skipReason(date);
  console.log(reason ? `skip ${reason}` : 'run');
  process.exitCode = reason ? 3 : 0;
}
