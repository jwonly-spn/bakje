// 추억앨범 운영자 도구 — 앨범 만들기·주소·등록 코드·봇 기기·보기만(readonly).
// 관리자 키는 `승인서버\관리자키-비밀.txt` 에서 읽기만 한다(화면에 찍지 않는다).
// 쓰는 법:
//   node tools\album-admin.cjs list
//   node tools\album-admin.cjs create <앨범번호> "<앨범 이름>" [주소...]     예) create meonchi "먼치 추억앨범" 먼치.먼치킨.com
//   node tools\album-admin.cjs host <앨범번호> <주소>  |  unhost <주소>
//   node tools\album-admin.cjs code <앨범번호> [일수=7] [기기수=2]           → DJ 에게 줄 주인 기기 등록 코드
//   node tools\album-admin.cjs bot <앨범번호> <먼치킨 기기 번호 앞 16자 이상>   |  unbot <기기 번호>
//   node tools\album-admin.cjs set <앨범번호> state=readonly|active name="..." note="..."
const fs = require('node:fs');
const path = require('node:path');

const API = 'https://aksegkhhugqvvaidgvro.supabase.co/functions/v1/bakje/admin';
const KEY = 'sb_publishable_45cIqG4dGLSlev-rmNiVDg_uG8szVzD';
const SECRET = path.join(__dirname, '..', '..', '승인서버', '관리자키-비밀.txt');

function adminKey() {
  const raw = fs.readFileSync(SECRET, 'utf8');
  const m = raw.match(/[A-Za-z0-9_-]{32,}/);
  if (!m) throw Error('관리자 키 파일 모양이 달라요.');
  return m[0];
}
async function call(body) {
  const res = await fetch(API, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json', 'x-junlive-admin': adminKey() }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw Error(data?.error || `실패 (${res.status})`);
  return data;
}

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  let out;
  switch (cmd) {
    case 'list': {
      const { albums } = await call({ action: 'list' });
      for (const a of albums) {
        console.log(`${a.id}  ${a.name || '(이름 없음)'}  [${a.state}]  글 ${a.posts} · 주인 기기 ${a.owners} · 봇 ${a.bots.length}`);
        for (const h of a.hosts) console.log(`   주소 ${require('node:url').domainToUnicode(h)} (https://${h}/)`);
        for (const b of a.bots) console.log(`   봇 ${b.id}… ${b.label}`);
      }
      return;
    }
    case 'create': out = await call({ action: 'create', id: args[0], name: args[1] || '', hosts: args.slice(2) }); break;
    case 'host': out = await call({ action: 'host', id: args[0], host: args[1] }); break;
    case 'unhost': out = await call({ action: 'unhost', host: args[0] }); break;
    case 'code': out = await call({ action: 'code', id: args[0], ...(args[1] ? { days: Number(args[1]) } : {}), ...(args[2] ? { uses: Number(args[2]) } : {}) }); break;
    case 'bot': out = await call({ action: 'bot', id: args[0], device: args[1] }); break;
    case 'unbot': out = await call({ action: 'unbot', device: args[0] }); break;
    case 'set': {
      const patch = Object.fromEntries(args.slice(1).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
      out = await call({ action: 'set', id: args[0], ...patch });
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 9).join('\n'));
      return;
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
