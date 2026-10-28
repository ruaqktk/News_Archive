import { cp, mkdir, rm, access, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readArchive, PUBLISHER_IDS } from './archive-lib.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const publicPath = join(projectRoot, 'public');
const outputPath = join(projectRoot, 'dist');

try {
  const archive = await readArchive(join(publicPath, 'data/archive.json'));
  await access(join(publicPath, 'index.html'));
  await rm(outputPath, { recursive: true, force: true });
  await mkdir(outputPath, { recursive: true });
  await cp(publicPath, outputPath, { recursive: true });
  // 로고 목록: public/assets/logos/<언론사ID>.svg|png 중 있는 것만 (SVG 우선)
  const files = await readdir(join(publicPath, 'assets/logos')).catch(() => []);
  const logos = {};
  for (const id of PUBLISHER_IDS) {
    const file = [`${id}.svg`, `${id}.png`].find((name) => files.includes(name));
    if (file) logos[id] = file;
  }
  await writeFile(join(outputPath, 'assets/logos.json'), `${JSON.stringify(logos)}\n`);
  console.log(JSON.stringify({ built: true, output: 'dist', logos: Object.keys(logos ?? {}).length, dates: archive.runs.length, articles: archive.runs.reduce((total, run) => total + run.articles.length, 0) }));
} catch (error) {
  console.error(`빌드 실패: ${error.message}`);
  process.exitCode = 1;
}
