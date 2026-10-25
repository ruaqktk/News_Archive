import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mergeRunFile } from './archive-lib.mjs';

const archivePath = fileURLToPath(new URL('../public/data/archive.json', import.meta.url));

try {
  if (!process.argv[2]) throw new Error('사용법: node scripts/merge-run.mjs path/to/run.json');
  const result = await mergeRunFile(archivePath, resolve(process.argv[2]));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`기사 저장 실패: ${error.message}`);
  process.exitCode = 1;
}
