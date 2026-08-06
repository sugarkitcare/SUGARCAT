// 법적 문서 md → 정적 HTML 변환 (v0.7.48 페이지 셸 재현)
// 사용법: node scripts/build_legal_page.mjs <입력.md> <출력.html> <privacy|terms>
// 원본 md는 OneDrive 고양이/sugarkey — md 수정 후 이 스크립트로 재생성해야 동기화 유지.
import { readFileSync, writeFileSync } from 'fs';

const [,, inPath, outPath, kind] = process.argv;
if (!inPath || !outPath || !['privacy','terms'].includes(kind)) {
  console.error('사용법: node scripts/build_legal_page.mjs <입력.md> <출력.html> <privacy|terms>');
  process.exit(1);
}

const md = readFileSync(inPath, 'utf8').replace(/\r\n/g, '\n');

const inline = s => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const lines = md.split('\n');
const out = [];
let i = 0, h1 = '', effective = '';

function collectList(marker) {
  const items = [];
  while (i < lines.length) {
    const m = marker === 'ul' ? lines[i].match(/^- (.*)$/) : lines[i].match(/^(\d+)\. (.*)$/);
    if (!m) break;
    items.push(marker === 'ul' ? inline(m[1]) : { v: m[1], t: inline(m[2]) });
    i++;
  }
  if (marker === 'ul') out.push('<ul>\n' + items.map(t => `<li>${t}</li>`).join('\n') + '\n</ul>');
  else out.push('<ol>\n' + items.map(o => `<li value="${o.v}">${o.t}</li>`).join('\n') + '\n</ol>');
}

function collectTable() {
  const rows = [];
  while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
  const parse = r => r.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
  const head = parse(rows[0]);
  const body = rows.slice(2).map(parse);
  out.push('<div class="tablewrap"><table><thead><tr>'
    + head.map(h => `<th>${h}</th>`).join('')
    + '</tr></thead><tbody>'
    + body.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('')
    + '</tbody></table></div>');
}

while (i < lines.length) {
  const line = lines[i];
  if (/^# (.*)$/.test(line)) { h1 = inline(line.slice(2)); out.push(`<h1>${h1}</h1>`); i++; continue; }
  if (/^## (.*)$/.test(line)) { out.push(`<h2>${inline(line.slice(3))}</h2>`); i++; continue; }
  if (/^### (.*)$/.test(line)) { out.push(`<h3>${inline(line.slice(4))}</h3>`); i++; continue; }
  if (/^---\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
  if (/^> /.test(line)) { // 인용 블록 → 안내 박스 (한시 공지 등)
    const parts = [];
    while (i < lines.length && /^> ?/.test(lines[i])) { const t = lines[i].replace(/^> ?/, ''); if (t.trim()) parts.push(inline(t)); i++; }
    out.push(`<div class="notice">${parts.join('<br>')}</div>`);
    continue;
  }
  if (/^- /.test(line)) { collectList('ul'); continue; }
  if (/^\d+\. /.test(line)) { collectList('ol'); continue; }
  if (/^\|/.test(line)) { collectTable(); continue; }
  if (line.trim() === '') { i++; continue; }
  // 문단 — 뒤 공백 2칸(hard break)은 <br>로 이어 한 문단으로
  const parts = [];
  while (i < lines.length && lines[i].trim() !== '' && !/^(#|##|###|---$|- |\d+\. |\|)/.test(lines[i])) {
    parts.push(inline(lines[i].replace(/\s+$/, '')));
    const hard = /\s{2,}$/.test(lines[i]);
    i++;
    if (!hard) break;
  }
  const text = parts.join('<br>');
  // 시행일 문단은 class=effective + meta description용으로 채집
  if (!effective && /^<strong>시행일/.test(text)) {
    effective = text.replace(/<[^>]+>/g, '').replace(/^시행일:\s*/, '');
    out.push(`<p class="effective">${text}</p>`);
  } else {
    out.push(`<p>${text}</p>`);
  }
}

const title = kind === 'privacy' ? '개인정보처리방침 · 케어마스터즈' : '이용약관 · 케어마스터즈';
const desc = kind === 'privacy'
  ? `케어마스터즈 개인정보처리방침 (시행일 ${effective})`
  : `케어마스터즈 반려묘 건강 관리 서비스 이용약관 (시행일 ${effective})`;
const nav = kind === 'privacy'
  ? '<nav><a href="/terms">이용약관</a> &middot; <a href="/">케어마스터즈 앱</a></nav>'
  : '<nav><a href="/privacy">개인정보처리방침</a> &middot; <a href="/">케어마스터즈 앱</a></nav>';

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#F3ECDD">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="icon" type="image/png" sizes="192x192" href="/icon_192.png">
<style>
:root{
  --bg:#F3ECDD; --surface:#FFFDF8; --line:#ECE2CF; --line2:#E3D7BF;
  --ink:#2A251D; --ink-soft:#5C5344; --faint:#938A78;
  --green-800:#1B4634; --green-700:#235B43; --green-ink:#1E5740;
  --green-tint:#E6F0E7; --green-edge:#BFD9C6;
}
*{box-sizing:border-box}
html{font-size:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:'Pretendard Variable',Pretendard,'Noto Sans KR',-apple-system,system-ui,sans-serif;
  line-height:1.75;-webkit-font-smoothing:antialiased;word-break:keep-all}
.wrap{max-width:720px;margin:0 auto;padding:1.25rem 1.25rem 3.5rem}
header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;
  padding:.5rem 0 1rem;border-bottom:1px solid var(--line2);margin-bottom:1.5rem}
.brand{display:flex;align-items:center;gap:8px;font-size:1rem;font-weight:800;
  color:var(--green-800);letter-spacing:-0.02em;text-decoration:none}
.brand .mark{width:28px;height:28px;flex:0 0 auto;background:var(--green-tint);
  border:1px solid var(--green-edge);border-radius:9px;display:flex;align-items:center;justify-content:center}
.back{font-size:.8rem;color:var(--green-700);text-decoration:none;white-space:nowrap;
  border:1px solid var(--green-edge);background:var(--green-tint);border-radius:999px;padding:.35rem .8rem;font-weight:600}
.back:hover{text-decoration:underline}
main h1{font-size:1.35rem;font-weight:800;color:var(--green-800);letter-spacing:-0.02em;
  line-height:1.35;margin:0 0 .25rem}
main .effective{font-size:.85rem;color:var(--green-ink);margin:0 0 1.5rem}
main h2{font-size:1.05rem;font-weight:800;color:var(--green-700);margin:2.25rem 0 .75rem;
  padding-top:1.5rem;border-top:1px solid var(--line2)}
main h3{font-size:.95rem;font-weight:700;color:var(--ink);margin:1.5rem 0 .5rem}
main p{font-size:.9rem;color:var(--ink-soft);margin:.5rem 0}
main ol,main ul{font-size:.9rem;color:var(--ink-soft);margin:.5rem 0;padding-left:1.4rem}
main li{margin:.3rem 0}
main li ul{margin:.25rem 0 .4rem}
main strong{color:var(--ink);font-weight:700}
main .notice{background:var(--green-tint);border:1px solid var(--green-edge);border-radius:10px;
  padding:.7rem .9rem;font-size:.85rem;color:var(--green-ink);margin:0 0 1.25rem;line-height:1.7}
main .notice a{color:var(--green-700);text-decoration:underline}
main hr{border:none;border-top:1px solid var(--line2);margin:2rem 0}
.tablewrap{overflow-x:auto;margin:.75rem 0}
table{border-collapse:collapse;width:100%;font-size:.85rem;background:var(--surface)}
th,td{border:1px solid var(--line2);padding:.5rem .65rem;text-align:left;vertical-align:top}
th{background:var(--green-tint);color:var(--green-ink);font-weight:700;white-space:nowrap}
footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--line2);
  font-size:.75rem;color:var(--faint);line-height:1.8}
footer a{color:var(--green-700);text-decoration:underline}
@media (max-width:480px){
  .wrap{padding:1rem 1rem 3rem}
  main h1{font-size:1.2rem}
}
@media print{
  body{background:#fff;color:#000}
  header,.back,footer nav{display:none}
  .wrap{max-width:none;padding:0}
  main h1,main h2,main h3{color:#000}
  main p,main li,main ol,main ul{color:#000}
}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="brand" href="/">
      <span class="mark"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#235B43" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
      케어마스터즈
    </a>
    <a class="back" href="/">&larr; 앱으로 돌아가기</a>
  </header>
  <main>
${out.join('\n')}
  </main>
  <footer>
    ${nav}
    문의: caremasters.cat@gmail.com
  </footer>
</div>
</body>
</html>
`;

// 기존 배포 파일과 동일하게 CRLF로 출력 (diff 검증 용이)
writeFileSync(outPath, html.replace(/\n/g, '\r\n'));
console.log(`OK: ${outPath} (${html.length} chars, 시행일 ${effective})`);
