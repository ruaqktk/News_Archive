import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readArchive } from './archive-lib.mjs';

const defaultPath = fileURLToPath(new URL('../public/data/archive.json', import.meta.url));

try {
  const archive = await readArchive(process.argv[2] ? resolve(process.argv[2]) : defaultPath);
  console.log(JSON.stringify({ valid: true, dates: archive.runs.length, publishers: archive.publishers.length, articles: archive.runs.reduce((total, run) => total + run.articles.length, 0) }));
} catch (error) {
  console.error(`데이터 검증 실패: ${error.message}`);
  process.exitCode = 1;
}
