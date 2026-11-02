// 박제관 사이트(docs/)를 GitHub(jwonly-spn/bakje)에 올리고 GitHub Pages 로 연다.
// 이 PC의 GitHub 로그인(git credential manager)을 쓴다. 비밀 값은 출력하지 않는다.
// 사용: node tools/deploy.cjs "커밋 메시지" [--domain]
//  - app.js·styles.css 주소 뒤에 내용 해시(?v=)를 붙여, 올리자마자 새 화면이 보이게 한다.
//  - --domain: 한이준.com(DOMAIN)으로 연다 — docs/CNAME·404 를 도메인 맨 앞(/) 기준으로 쓰고 Pages 사용자 도메인을 맞춘다.
//    후이즈 DNS(A @ → GitHub Pages 4개, CNAME www → jwonly-spn.github.io)를 먼저 해 둬야 한다. 한 번 켜면 그 뒤로는 docs/CNAME 이 있으면 저절로.
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), {spawnSync} = require('node:child_process');
const OWNER = 'jwonly-spn', NAME = 'bakje', ROOT = path.join(__dirname, '..');
const DOMAIN = 'xn--hu5bi2af5y.com';   // 한이준.com
const GIT = 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git';
const env = {...process.env, GIT_EXEC_PATH: GIT + '/mingw64/bin', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never'};
const git = (...args) => {
  const r = spawnSync(GIT + '/cmd/git.exe', ['-c', 'safe.directory=' + ROOT.replace(/\\/g, '/'), '-C', ROOT, ...args], {encoding: 'utf8', env, windowsHide: true, timeout: 120000});
  if (r.status !== 0) throw Error(`git ${args[0]} 실패: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return r.stdout.trim();
};
const auth = spawnSync(GIT + '/cmd/git.exe', ['credential', 'fill'], {input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env, windowsHide: true, timeout: 15000});
const cred = Object.fromEntries((auth.stdout || '').trim().split('\n').map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
if (!cred.password) throw Error('GitHub 로그인 정보를 찾을 수 없어요.');
const headers = {Authorization: 'Bearer ' + cred.password, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'};
async function gh(route, init = {}) {
  const r = await fetch('https://api.github.com' + route, {...init, headers: {...headers, ...init.headers}});
  if (r.status === 404 && init.allowMissing) return null;
  const text = await r.text();
  if (!r.ok && !(init.allow || []).includes(r.status)) throw Error(`GitHub ${r.status} ${route}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const DOCS = path.join(ROOT, 'docs');
const hash8 = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DOCS, f))).digest('hex').slice(0, 8);
const useDomain = process.argv.includes('--domain') || fs.existsSync(path.join(DOCS, 'CNAME'));
const BASE = useDomain ? '/' : `/${NAME}/`;
const SITE = useDomain ? `https://${DOMAIN}/` : `https://${OWNER}.github.io/${NAME}/`;
function stamp() {
  const file = path.join(DOCS, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/href="styles\.css(\?v=[0-9a-f]+)?"/, `href="styles.css?v=${hash8('styles.css')}"`)
    .replace(/src="app\.js(\?v=[0-9a-f]+)?"/, `src="app.js?v=${hash8('app.js')}"`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${SITE}profile.webp">`);
  fs.writeFileSync(file, html);
  // 없는 주소 → 앨범 첫 화면(github.io 는 /bakje/, 한이준.com 은 /)
  const nf = path.join(DOCS, '404.html');
  fs.writeFileSync(nf, fs.readFileSync(nf, 'utf8').replace(/url=[^"]*"/, `url=${BASE}"`).replace(/href="[^"]*">한이준/, `href="${BASE}">한이준`));
  if (useDomain) fs.writeFileSync(path.join(DOCS, 'CNAME'), DOMAIN + '\n');
}

(async () => {
  for (const f of ['docs/index.html', 'docs/app.js', 'docs/styles.css', 'docs/404.html', 'docs/.nojekyll']) if (!fs.existsSync(path.join(ROOT, f))) throw Error(f + ' 이 없어요.');
  const risky = spawnSync('cmd', ['/c', 'dir', '/s', '/b', ROOT], {encoding: 'utf8'}).stdout.split(/\r?\n/).filter(p => /(\.pem|\.env|관리자키|secret|private|등록코드)/i.test(p));
  if (risky.length) throw Error('비밀 파일로 보이는 파일이 있어요: ' + risky.join(', '));
  stamp();
  if (!fs.existsSync(path.join(ROOT, '.git'))) git('init', '-b', 'main');
  fs.writeFileSync(path.join(ROOT, '.gitignore'), 'node_modules/\n*.log\n.DS_Store\n.claude/\n확인/\n');
  git('add', '-A');
  const msg = (process.argv.slice(2).find(a => !a.startsWith('--')) || 'Update bakje') + '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
  if (git('status', '--porcelain')) git('-c', 'user.name=JUN LIVE', '-c', 'user.email=jwonly-spn@users.noreply.github.com', 'commit', '-q', '-m', msg);
  let repo = await gh(`/repos/${OWNER}/${NAME}`, {allowMissing: true});
  if (!repo) {
    repo = await gh('/user/repos', {method: 'POST', body: JSON.stringify({name: NAME, description: '박제관 — 박제판과 박제 편지를 모아 두는 개인 페이지', homepage: `https://${OWNER}.github.io/${NAME}/`, private: false, has_issues: false, has_wiki: false, has_projects: false, auto_init: false})});
    console.log('저장소를 만들었어요:', repo.html_url);
  }
  if (!git('remote').split('\n').includes('origin')) git('remote', 'add', 'origin', `https://github.com/${OWNER}/${NAME}.git`);
  git('push', '-u', 'origin', 'main');
  const head = git('rev-parse', 'HEAD');
  console.log('올린 커밋:', head.slice(0, 7));
  let pages = await gh(`/repos/${OWNER}/${NAME}/pages`, {allowMissing: true});
  if (!pages) pages = await gh(`/repos/${OWNER}/${NAME}/pages`, {method: 'POST', body: JSON.stringify({source: {branch: 'main', path: '/docs'}})});
  for (let i = 0; i < 60; i++) {
    const b = await gh(`/repos/${OWNER}/${NAME}/pages/builds/latest`, {allowMissing: true});
    if (b && b.commit === head && b.status === 'built') break;
    if (b && b.commit === head && b.status === 'errored') throw Error('GitHub Pages 빌드 실패: ' + JSON.stringify(b.error));
    await new Promise(r => setTimeout(r, 5000));
  }
  pages = await gh(`/repos/${OWNER}/${NAME}/pages`);
  const src = {branch: 'main', path: '/docs'};
  if (useDomain && pages.cname !== DOMAIN) {
    await gh(`/repos/${OWNER}/${NAME}/pages`, {method: 'PUT', body: JSON.stringify({cname: DOMAIN, source: src})});
    // 사용자 도메인을 붙이면 GitHub 이 docs/CNAME 커밋을 만들 수 있다 → 다음에 올릴 때 겹치지 않게 받아 둔다
    try { git('pull', '--rebase', '-q', 'origin', 'main'); } catch (e) { console.log('(받기는 다음에)', e.message.slice(0, 120)); }
  }
  pages = await gh(`/repos/${OWNER}/${NAME}/pages`);
  if (!pages.https_enforced) await gh(`/repos/${OWNER}/${NAME}/pages`, {method: 'PUT', allow: [400, 404, 422], body: JSON.stringify({...(useDomain ? {cname: DOMAIN} : {}), https_enforced: true, source: src})});
  pages = await gh(`/repos/${OWNER}/${NAME}/pages`);
  console.log('주소:', pages.html_url, '· https 강제:', pages.https_enforced, useDomain ? `· 인증서: ${pages.https_certificate?.state || '없음'}` : '');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
