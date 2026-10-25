import { cp, mkdir, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readArchive } from './archive-lib.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const publicPath = join(projectRoot, 'public');
const outputPath = join(projectRoot, 'dist');

try {
  const archive = await readArchive(join(publicPath, 'data/archive.json'));
  await access(join(publicPath, 'index.html'));
  await rm(outputPath, { recursive: true, force: true });
  await mkdir(outputPath, { recursive: true });
  await cp(publicPath, outputPath, { recursive: true });
  console.log(JSON.stringify({ built: true, output: 'dist', dates: archive.runs.length, articles: archive.runs.reduce((total, run) => total + run.articles.length, 0) }));
} catch (error) {
  console.error(`빌드 실패: ${error.message}`);
  process.exitCode = 1;
}
