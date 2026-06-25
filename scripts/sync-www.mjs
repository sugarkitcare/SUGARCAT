// 원본(루트) → www/ 복사 스크립트
// www/ 는 Capacitor webDir. 단일 소스(루트 index.html)에서 항상 재생성되는 산출물.
// ⚠️ api/ (서버리스), sw.js, *.bak 은 복사하지 않음. AI 호출은 v0.6.95 절대 URL로 vercel.app 경유.
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WWW = join(ROOT, 'www');

// 앱 번들에 들어갈 자산 (CDN 의존: Chart.js·supabase-js·폰트는 네트워크 로드)
const ASSETS = [
  'index.html',
  'cm_fooddb.js',
  'cm.css',
  'manifest.json',
  'icon_180.png',
  'icon_192.png',
  'icon_512.png',
];

// www 초기화 후 재생성 (drift 방지: 통째 새로 복사)
if (existsSync(WWW)) rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });

let copied = 0;
for (const name of ASSETS) {
  const src = join(ROOT, name);
  if (!existsSync(src)) {
    console.error(`[sync-www] 누락: ${name} — 원본 루트에 없음`);
    process.exit(1);
  }
  copyFileSync(src, join(WWW, name));
  copied++;
}

console.log(`[sync-www] ${copied}개 자산 복사 완료 → www/`);
