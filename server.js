// Server StreamDeck HP: WebSocket cepat, PowerShell tetap hidup, pairing lewat QR
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const net = require('net');
const https = require('https');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

// Port yang biasanya sudah dipakai program lain (ditolak saat user mengganti port)
const AVOID = [[3306, 'MySQL'], [3389, 'Remote Desktop Windows'], [4200, 'Angular'], [4455, 'OBS WebSocket'], [5000, 'Flask / AirPlay'], [5173, 'Vite'], [5432, 'PostgreSQL'], [5500, 'Live Server VS Code'], [5900, 'VNC'], [6379, 'Redis'], [8000, 'server web lokal'], [8080, 'server web / proxy'], [8888, 'Jupyter'], [27017, 'MongoDB']].map(([port, name]) => ({ port, name }));
const portFree = (p) => new Promise((r) => { const t = net.createServer(); t.once('error', () => r(false)); t.once('listening', () => t.close(() => r(true))); t.listen(p, '0.0.0.0'); });

const DEFAULT = () => ({ cols: 5, rows: 3, devices: [], pages: [{ keys: {} }] });

// Pengaturan mikrofon virtual. id: '' = otomatis, 'default' = default Windows, 'off' = mati, 'none' = jangan kirim ke teman
const AUDIO_DEF = () => ({ virt: { id: '', label: '' }, mon: { id: 'default', label: '' }, mic: { id: '', label: '' }, vVol: 100, mVol: 100, micVol: 100, auto: 1 });
const cleanAudio = (o) => {
  const d = AUDIO_DEF(); o = o && typeof o === 'object' ? o : {};
  const dv = (x, def) => (x && typeof x === 'object' ? { id: typeof x.id === 'string' ? x.id.slice(0, 300) : def.id, label: typeof x.label === 'string' ? x.label.slice(0, 300) : '' } : def);
  const vl = (n, def, max) => (Number.isFinite(+n) && n !== '' && n !== null ? Math.min(max, Math.max(0, Math.round(+n))) : def);
  return { virt: dv(o.virt, d.virt), mon: dv(o.mon, d.mon), mic: dv(o.mic, d.mic), vVol: vl(o.vVol, 100, 200), mVol: vl(o.mVol, 100, 100), micVol: vl(o.micVol, 100, 200), auto: o.auto === 0 || o.auto === false || o.auto === '0' ? 0 : 1 };
};
const VB = require('./vbsetup');
const OBSM = require('./obs');
const withTimeout = (pr, ms) => Promise.race([Promise.resolve(pr).catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);

let H = {};
const APPV = (() => { try { return require('./package.json'); } catch (e) { return {}; } })();
const verNum = (v) => String(v || '').replace(/^v/i, '').split(/[.\-+]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
const isNewer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
// Cek rilis terbaru di GitHub (repo diisi otomatis oleh build di package.json: updateRepo)
function checkUpdate() {
  return new Promise((res) => {
    const repo = String(APPV.updateRepo || '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res({ state: 'norepo' });
    const rq = https.get({ hostname: 'api.github.com', path: '/repos/' + repo + '/releases/latest', headers: { 'User-Agent': 'gatito-stream-tool', Accept: 'application/vnd.github+json' }, timeout: 8000 }, (rs) => {
      let b = ''; rs.on('data', (c) => (b += c));
      rs.on('end', () => {
        if (rs.statusCode === 404) return res({ state: 'norelease' });
        try {
          const j = JSON.parse(b);
          if (rs.statusCode !== 200 || !j.tag_name) return res({ state: 'error' });
          const nw = isNewer(j.tag_name, APPV.version), as = Array.isArray(j.assets) ? j.assets : [];
          const a = as.find((x) => x && /^gatito-stream-tool-v[\d.]+\.exe$/i.test(String(x.name))) || as.find((x) => x && /\.exe$/i.test(String(x.name)));
          const ok = !!a && typeof a.browser_download_url === 'string' && /^https:\/\/github\.com\//.test(a.browser_download_url);
          const dg = ok && /^sha256:([a-f0-9]{64})$/i.exec(String(a.digest || ''));
          res({ state: nw ? 'new' : 'latest', latest: String(j.tag_name).replace(/^v/i, ''), url: j.html_url, asset: nw && ok, _a: nw && ok ? { url: a.browser_download_url, name: String(a.name).replace(/[^\w.\-]/g, '_'), size: +a.size || 0, sha: dg ? dg[1].toLowerCase() : '' } : null });
        } catch (e) { res({ state: 'error' }); }
      });
    });
    rq.on('timeout', () => rq.destroy()); rq.on('error', () => res({ state: 'error' }));
  });
}
// Unduh dan pasang update otomatis: berkas diunduh ke folder sementara, diperiksa ukuran dan hash-nya, lalu dipasang diam-diam oleh main.js
const UP = { state: 'idle', pct: 0 };
function download(url, dest, size, hops, onPct) {
  return new Promise((res, rej) => {
    if (hops > 5 || !/^https:\/\//.test(url)) return rej(new Error('url'));
    const rq = https.get(url, { headers: { 'User-Agent': 'gatito-stream-tool' }, timeout: 20000 }, (rs) => {
      if ([301, 302, 303, 307, 308].includes(rs.statusCode) && rs.headers.location) { rs.resume(); return download(new URL(rs.headers.location, url).href, dest, size, hops + 1, onPct).then(res, rej); }
      if (rs.statusCode !== 200) { rs.resume(); return rej(new Error('http ' + rs.statusCode)); }
      const total = +rs.headers['content-length'] || size || 0, h = crypto.createHash('sha256'), f = fs.createWriteStream(dest);
      let got = 0, last = -1;
      rs.on('data', (c) => { got += c.length; h.update(c); if (total) { const p = Math.min(99, Math.floor(got * 100 / total)); if (p !== last) { last = p; onPct(p); } } });
      rs.on('error', rej); f.on('error', rej);
      rs.pipe(f);
      f.on('finish', () => res({ sha: h.digest('hex'), got }));
    });
    rq.on('timeout', () => rq.destroy(new Error('timeout'))); rq.on('error', rej);
  });
}
async function fetchUpdate(a) {
  const dir = path.join(os.tmpdir(), 'gatito-update'), dest = path.join(dir, a.name);
  try {
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const r = await download(a.url, dest, a.size, 0, (p) => { UP.pct = p; });
    if ((a.size && r.got !== a.size) || (a.sha && r.sha !== a.sha)) throw new Error('berkas tidak cocok');
    UP.pct = 100; UP.state = 'ready';
    if (!H.applyUpdate || !H.applyUpdate(dest)) throw new Error('tidak bisa dipasang');
  } catch (e) { UP.state = 'error'; try { fs.rmSync(dir, { recursive: true, force: true }); } catch (x) {} }
}
const MEDIA = { volup: 175, voldown: 174, mute: 173, playpause: 179, next: 176, prev: 177 };
const q = (s) => String(s).replace(/'/g, "''");
// Volume tombol 0 sampai 200. Angka 0 harus tetap 0 (bukan jatuh ke 80)
const volOf = (v) => { const n = parseInt(v, 10); return Math.min(200, Math.max(0, Number.isFinite(n) ? n : 80)) / 100; };
const escKeys = (s) => s.replace(/[+^%~(){}\[\]]/g, (m) => '{' + m + '}').replace(/\r?\n/g, '{ENTER}');

// PowerShell dibuka sekali lalu dipakai terus, supaya tombol langsung bereaksi
const PS_INIT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$w=New-Object -ComObject WScript.Shell; $pl=@{}',
  `Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, int f, int e);'`,
  // Kode scan ikut dikirim (F13 sampai F23 = 0x64 sampai 0x6E, F24 = 0x76), supaya aplikasi selain OBS (Discord, game, browser) juga mengenali tombolnya
  'function sdsc($v){if($v -eq 135){118}else{100+$v-124}}',
  'function sdms($v){if($v -eq 17){29}elseif($v -eq 16){42}else{56}}',
  'function sdvk($v,$m){$k=@();if($m -match "c"){$k+=17};if($m -match "s"){$k+=16};if($m -match "a"){$k+=18};foreach($x in $k){[W.K]::keybd_event($x,(sdms $x),0,0)};$s=sdsc $v;[W.K]::keybd_event($v,$s,0,0);Start-Sleep -Milliseconds 120;[W.K]::keybd_event($v,$s,2,0);foreach($x in $k){[W.K]::keybd_event($x,(sdms $x),2,0)}}',
].join('\n') + '\n';

let psProc = null;
function ps(cmd) {
  if (!psProc) {
    const p = spawn('powershell', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-'], { windowsHide: true });
    psProc = p;
    p.on('exit', () => { if (psProc === p) psProc = null; });
    p.on('error', () => { if (psProc === p) psProc = null; });
    p.stdin.on('error', () => {});
    p.stdout.on('data', () => {});
    p.stderr.on('data', () => {});
    p.stdin.write(PS_INIT);
  }
  psProc.stdin.write(cmd + '\n');
}

function run(k, id) {
  if (!k) return;
  const a = k.action;
  if (a === 'hotkey' && k.keys) ps(`[System.Windows.Forms.SendKeys]::SendWait('${q(k.keys)}')`);
    else if (a === 'vkey') {
    let n = 0, mod = '';
    const f = /^F(\d+)$/.exec(k.vk || ''), kk = /^K(\d+)$/.exec(k.vk || '');
    if (f) n = +f[1];
    else if (kk && +kk[1] >= 1 && +kk[1] <= 36) { const i = +kk[1] - 1; n = 13 + (i % 12); mod = ['cs', 'ca', 'sa'][Math.floor(i / 12)]; }
    if (n >= 13 && n <= 24) ps(`sdvk ${111 + n} '${mod || q(k.mod || '')}'`);
  }
  else if ((a === 'open' || a === 'web') && k.target) { let t = k.target; if (a === 'web' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'https://' + t; ps(`Start-Process '${q(t)}'`); }
  else if (a === 'text' && k.text) ps(`[System.Windows.Forms.SendKeys]::SendWait('${q(escKeys(k.text))}')`);
  else if (a === 'media' && MEDIA[k.key]) ps(`$w.SendKeys([char]${MEDIA[k.key]})`);
  else if (a === 'sound' && k.file) { if (H.play) H.play(id, k.file, volOf(k.vol)); }
  else if (a === 'stopsound') { if (H.stop) H.stop(); }
}

function listApps() {
  const roots = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ];
  const out = new Map();
  const walk = (d, depth) => {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); }
      else if (/\.lnk$/i.test(e.name)) {
        const n = e.name.replace(/\.lnk$/i, '');
        if (!/uninstall|readme|help|documentation|license|[o0]ptional/i.test(n)) out.set(n.toLowerCase(), { name: n, path: p });
      }
    }
  };
  roots.forEach((r) => walk(r, 0));
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const FIELDS = ['label', 'color', 'action', 'keys', 'target', 'appName', 'text', 'key', 'to', 'vk', 'mod', 'file', 'vol', 'crt'];
const clean = (o) => {
  const r = {};
  for (const f of FIELDS) if (typeof o[f] === 'string') r[f] = o[f].slice(0, 400);
  if (typeof o.img === 'string' && (/^\/img\/[a-f0-9]{40}\.(png|gif|jpg|webp)$/.test(o.img) || (o.img.startsWith('data:image/') && o.img.length < 400000))) r.img = o.img;
  return r;
};
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const ips = () => Object.values(os.networkInterfaces()).flat()
  .filter((i) => (i.family === 'IPv4' || i.family === 4) && !i.internal).map((i) => i.address)
  .sort((a, b) => b.startsWith('192.168') - a.startsWith('192.168'));
const newCode = () => String(crypto.randomInt(100000, 999999));

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
let extracting = false;
// Ikon aplikasi diambil lewat proses PowerShell terpisah supaya aplikasi utama tidak ikut crash
function extractIcons(list, dir) {
  if (extracting || process.platform !== 'win32') return;
  extracting = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const todo = list.filter((a) => !fs.existsSync(path.join(dir, sha1(a.path) + '.png')));
    if (!todo.length) { extracting = false; return; }
    fs.writeFileSync(path.join(dir, 'list.txt'), todo.map((a) => sha1(a.path) + '|' + a.path).join('\n'), 'utf8');
    const d = dir.replace(/'/g, "''");
    const script = "$ErrorActionPreference='SilentlyContinue';Add-Type -AssemblyName System.Drawing;$sh=New-Object -ComObject WScript.Shell;" +
      `Get-Content -Encoding UTF8 '${d}\\list.txt' | ForEach-Object { $p=$_.Split('|',2); $t=$sh.CreateShortcut($p[1]).TargetPath; if(-not $t -or -not (Test-Path $t)){$t=$p[1]}; $ic=[System.Drawing.Icon]::ExtractAssociatedIcon($t); if($ic){ $ic.ToBitmap().Save('${d}\\'+$p[0]+'.png',[System.Drawing.Imaging.ImageFormat]::Png) } }`;
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    p.on('exit', () => { extracting = false; });
    p.on('error', () => { extracting = false; });
  } catch (e) { extracting = false; }
}

function start(file, port, hooks) {
  H = hooks;
  let st;
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { try { st = JSON.parse(fs.readFileSync(file + '.bak', 'utf8')); } catch (e2) { st = DEFAULT(); } }
  if (!st.profiles) { st.profiles = [{ name: 'Default Profile', pages: st.pages || DEFAULT().pages }]; st.cur = 0; delete st.pages; }
  st.audio = cleanAudio(st.audio);
  st.obs = OBSM.clean(st.obs);
  let lastBak = 0;
  const save = () => { try { if (fs.existsSync(file) && Date.now() - lastBak > 60000) { fs.copyFileSync(file, file + '.bak'); lastBak = Date.now(); } fs.writeFileSync(file, JSON.stringify(st)); } catch (e) {} };
  const P = () => st.profiles[st.cur].pages;
  const usedVk = () => {
    const out = [];
    st.profiles.forEach((pr, pi) => pr.pages.forEach((pg, pgi) => Object.entries(pg.keys).forEach(([ki, k]) => {
      if (k.action === 'vkey') out.push({ vk: k.vk, label: k.label || '', img: k.img || '', color: k.color || '', prof: pr.name, page: pgi + 1, pi, pg: pgi, ki: +ki });
    })));
    return out;
  };
  const pub = () => ({ cols: st.cols, rows: st.rows, pages: P(), profiles: st.profiles.map((p) => p.name), cur: st.cur, usedVk: usedVk(), ips: ips() });
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const broadcast = () => { const m = JSON.stringify({ t: 'state', state: pub() }); wss.clients.forEach((c) => c.readyState === 1 && c.send(m)); };
  const phoneObs = (s) => { const { outs, ...r } = s; return r; }; // HP tidak butuh daftar output
  const obs = OBSM.create((s) => { const m = JSON.stringify({ t: 'obs', obs: phoneObs(s) }); wss.clients.forEach((c) => c.readyState === 1 && c.send(m)); });
  obs.configure(st.obs);
  const obsPub = () => ({ on: st.obs.on, host: st.obs.host, port: st.obs.port, hasPass: !!st.obs.pass });
  const sameOrigin = (req) => { const o = req.headers.origin; return !o || o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`; };
  // Mic otomatis: saat Gatito dibuka Virtual Mic jadi mic default Windows, saat ditutup mic asli dikembalikan
  const autoMic = {
    on: async () => {
      if (process.platform !== 'win32' || !st.audio.auto) return;
      const r = await VB.useVirtual();
      if (r && r.real) {
        let ch = false;
        if (st.realMic !== r.real) { st.realMic = r.real; ch = true; }
        // Kunci mic asli supaya mesin suara tetap memakainya walau default Windows sudah Virtual Mic
        if (!st.audio.mic.id && !st.audio.mic.label) { st.audio.mic = { id: '', label: r.real }; ch = true; if (H.audioCfg) H.audioCfg(st.audio, true); }
        if (ch) save();
      }
    },
    off: async () => {
      if (process.platform !== 'win32' || !st.audio.auto) return;
      let real = st.audio.mic.label || st.realMic || '';
      if (!real) { const inf = H.audioInfo ? await withTimeout(H.audioInfo(), 2500) : null; real = inf && inf.mic && !/^(Mati|Belum|Gagal|Tidak)/.test(inf.mic) ? inf.mic : ''; }
      if (real) await VB.restoreIfVirtual(real);
    }
  };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  let code = newCode(), bad = 0, appsCache = [];
  const imgDir = path.join(path.dirname(file), 'images'), iconDir = path.join(path.dirname(file), 'icons');
  ps('$null');

  const server = http.createServer((req, res) => {
    const send = (c, t, b) => { res.writeHead(c, Object.assign({ 'Content-Type': t }, cors)); res.end(b); };
    const json = (o) => send(200, 'application/json', JSON.stringify(o));
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const p = req.url.split('?')[0], local = isLocal(req);
    if (p === '/hello') return json({ app: 'streamdeck-hp', name: os.hostname() });
    const im = p.match(/^\/img\/([a-f0-9]{40}\.(png|gif|jpg|webp))$/);
    if (im) {
      try { res.writeHead(200, Object.assign({ 'Content-Type': 'image/' + (im[2] === 'jpg' ? 'jpeg' : im[2]), 'Cache-Control': 'max-age=31536000' }, cors)); return res.end(fs.readFileSync(path.join(imgDir, im[1]))); }
      catch (e) { return send(404, 'text/plain', ''); }
    }
    if (p === '/') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'mobile', 'www', 'index.html'), 'utf8').replace(/__VERSION__/g, String(APPV.version || '')).replace(/__REPO__/g, String(APPV.updateRepo || '')));
    if (local && p === '/appinfo') return json({ version: APPV.version || '' });
    if (local && p === '/obs-logo.png') { try { return send(200, 'image/png', fs.readFileSync(path.join(__dirname, 'assets', 'obs-logo.png'))); } catch (e) { return send(404, 'text/plain', ''); } }
    if (local && req.method === 'POST' && p === '/update/check') return checkUpdate().then(({ _a, ...r }) => json(r));
    if (local && p === '/update/status') return json(UP);
    if (local && req.method === 'POST' && p === '/update/install') {
      if (!sameOrigin(req)) return send(403, 'text/plain', 'forbidden');
      if (UP.state === 'down' || UP.state === 'ready') return json(UP);
      return checkUpdate().then((r) => {
        if (r.state !== 'new' || !r._a) { UP.state = 'error'; return json(UP); }
        UP.state = 'down'; UP.pct = 0; fetchUpdate(r._a);
        json(UP);
      });
    }
    if (local && req.method === 'POST' && p === '/update/open') {
      if (!sameOrigin(req)) return send(403, 'text/plain', 'forbidden');
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch (e) {} if (typeof j.url === 'string' && /^https:\/\/github\.com\//.test(j.url) && H.openUrl) H.openUrl(j.url); json({ ok: 1 }); });
      return;
    }
    if (local && p === '/editor') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'editor.html')));
    if (local && p === '/pairinfo') return json({ code, ips: ips(), port, wanted: H.wantedPort ? H.wantedPort() : port });
    if (local && p === '/portinfo') return json({ port, avoid: AVOID });
    if (local && req.method === 'POST' && (p === '/port-set' || p === '/restart')) {
      const o = req.headers.origin;
      if (o && o !== `http://127.0.0.1:${port}` && o !== `http://localhost:${port}`) return send(403, 'text/plain', 'forbidden');
      if (p === '/restart') { json({ ok: true }); setTimeout(() => H.relaunch && H.relaunch(), 300); return; }
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', async () => {
        let j = {}; try { j = JSON.parse(b); } catch (e) {}
        const n = Number(j.port);
        if (!Number.isInteger(n) || n < 1024 || n > 65535) return json({ error: 'Port harus angka bulat antara 1024 dan 65535.' });
        if (n !== port) {
          const av = AVOID.find((x) => x.port === n);
          if (av) return json({ error: `localhost:${n} telah digunakan oleh ${av.name}. Pilih port lain (tombol Hindari menampilkan daftarnya).` });
          if (!(await portFree(n))) return json({ error: `localhost:${n} telah digunakan oleh program lain. Pilih port lain.` });
        }
        try { H.savePort(n); } catch (e) { return json({ error: 'Gagal menyimpan port.' }); }
        json({ ok: true, restart: n !== port });
      });
      return;
    }
    if (local && p === '/apps') { appsCache = listApps(); extractIcons(appsCache, iconDir); return json(appsCache); }
    if (local && p === '/icon') {
      const a = appsCache[+new URL(req.url, 'http://x').searchParams.get('i')];
      if (!a) return send(404, 'text/plain', '');
      try { return send(200, 'image/png', fs.readFileSync(path.join(iconDir, sha1(a.path) + '.png'))); } catch (e) { return send(404, 'text/plain', ''); }
    }
    if (local && p === '/vpad') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'vpad.html')));
    if (local && req.method === 'POST' && p === '/vpad/open') { hooks.openVPad(); return json({ ok: 1 }); }
    if (local && req.method === 'POST' && p === '/vpad/close') { hooks.closeVPad(); return json({ ok: 1 }); }
    if (local && p === '/audio/settings' && req.method === 'GET') return json(st.audio);
    if (local && p === '/audio/settings' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        let j = {}; try { j = JSON.parse(b); } catch (e) {}
        const wasAuto = st.audio.auto;
        st.audio = cleanAudio(j); save();
        if (H.audioCfg) H.audioCfg(st.audio);
        if (!wasAuto && st.audio.auto) autoMic.on().catch(() => {});
        json(st.audio);
      });
      return;
    }
    if (local && p === '/audio/info') return withTimeout(H.audioInfo && H.audioInfo(), 8000).then((i) => json(Object.assign({ cfg: st.audio, ready: !!i }, i || {})));
    if (local && p === '/audio/level') return withTimeout(H.audioLevel && H.audioLevel(), 1500).then((l) => json(l || { mic: 0, out: 0 }));
    if (local && req.method === 'POST' && p === '/audio/refresh') { if (H.audioCfg) H.audioCfg(st.audio, true); return json({ ok: 1 }); }
    if (local && req.method === 'POST' && p === '/audio/test') { if (H.audioTest) H.audioTest(); return json({ ok: 1 }); }
    if (local && p === '/audio/install/status') return json(VB.status());
    if (local && req.method === 'POST' && p === '/audio/install') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        let j = {}; try { j = JSON.parse(b); } catch (e) {}
        if (VB.status().running) return json(VB.status());
        (async () => {
          const inf = H.audioInfo ? await withTimeout(H.audioInfo(), 5000) : null;
          const eng = inf && inf.mic && !/^(Mati|Belum|Gagal|Tidak)/.test(inf.mic) ? inf.mic : '';
          const res = await VB.run({ install: !!j.install, mic: st.audio.mic.label || '', engineMic: eng });
          // Simpan mic asli supaya Gatito tetap memakainya walau default Windows sudah jadi Virtual Mic
          if (res && res.ok && res.mic && res.mic !== 'Microphone' && !st.audio.mic.id && !st.audio.mic.label) { st.audio.mic = { id: '', label: res.mic }; save(); }
          if (H.audioCfg) H.audioCfg(st.audio, true);
        })().catch((e) => console.error('vbsetup:', e));
        json(Object.assign({ running: true }, VB.status()));
      });
      return;
    }
    if (local && req.method === 'POST' && p === '/audio/restoremic') {
      (async () => {
        const inf = H.audioInfo ? await withTimeout(H.audioInfo(), 5000) : null;
        const real = st.audio.mic.label || (inf && inf.mic && !/^(Mati|Belum|Gagal|Tidak)/.test(inf.mic) ? inf.mic : '');
        const r = await VB.restoreMic(real);
        if (H.audioCfg) H.audioCfg(st.audio, true);
        json(r);
      })().catch(() => json({ ok: false, err: 'Gagal.' }));
      return;
    }
    if (local && p === '/obs/settings' && req.method === 'GET') return json(obsPub());
    if (local && p === '/obs/status') return json(obs.state());
    if (local && p === '/obs/settings' && req.method === 'POST') {
      if (!sameOrigin(req)) return send(403, 'text/plain', 'forbidden');
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        let j = {}; try { j = JSON.parse(b); } catch (e) {}
        st.obs = OBSM.clean(j, st.obs); save(); obs.configure(st.obs);
        json(obsPub());
      });
      return;
    }
    if (local && p === '/audiohost') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'audio.html')));
    if (local && p === '/snd') {
      const f = new URL(req.url, 'http://x').searchParams.get('f') || '';
      const m = /\.(mp3|wav|ogg|m4a|aac|flac)$/i.exec(f);
      if (!m || !fs.existsSync(f)) return send(404, 'text/plain', '');
      res.writeHead(200, Object.assign({ 'Content-Type': { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' }[m[1].toLowerCase()] }, cors));
      return fs.createReadStream(f).pipe(res);
    }
    if (local && p === '/qr.svg') {
      const url = `http://${ips()[0] || '127.0.0.1'}:${port}/?code=${code}&h=${ips().join(',')}`;
      return QRCode.toString(url, { type: 'svg', margin: 1 }).then((s) => send(200, 'image/svg+xml', s));
    }
    if (local && req.method === 'POST' && p === '/pick/audio') return hooks.pickAudio().then((f) => json({ file: f }));
        if (local && req.method === 'POST' && p === '/pick/image') return hooks.pickImage().then((r) => {
      if (!r) return json({ img: null });
      const name = sha1(r.data) + '.' + r.ext;
      fs.mkdirSync(imgDir, { recursive: true });
      fs.writeFileSync(path.join(imgDir, name), r.data);
      json({ img: '/img/' + name });
    });
    if (p === '/pair' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        let j = {}; try { j = JSON.parse(b); } catch (e) {}
        if (!j.code || String(j.code) !== code) { if (++bad >= 5) { code = newCode(); bad = 0; } return send(403, 'text/plain', 'kode salah'); }
        const token = crypto.randomBytes(16).toString('hex');
        st.devices.push({ name: String(j.name || 'HP').slice(0, 40), token });
        save(); code = newCode(); bad = 0;
        json({ token, pc: os.hostname() });
      });
      return;
    }
    send(404, 'text/plain', '');
  });

  server.on('upgrade', (req, sock, head) => {
    const u = new URL(req.url, 'http://x'), local = isLocal(req);
    const ok = u.pathname === '/ws' && (local || st.devices.some((d) => d.token === u.searchParams.get('token')));
    if (!ok) { sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return sock.destroy(); }
    wss.handleUpgrade(req, sock, head, (ws) => { ws.local = local; wss.emit('connection', ws); });
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ t: 'state', state: pub() }));
    ws.send(JSON.stringify({ t: 'obs', obs: phoneObs(obs.state()) }));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      const pg = P()[m.p];
      if (m.t === 'press') return run(pg && pg.keys[m.k], m.p + '-' + m.k);
      if (m.t === 'vsend') { run({ action: 'vkey', vk: String(m.vk) }, 'v'); return; }
      if (m.t === 'prof') { if (st.profiles[m.i]) { st.cur = m.i; save(); broadcast(); } return; }
      if (!ws.local) return;
      if (m.t === 'test') { setTimeout(() => run(clean(m.key || {}), 'test'), Math.min(10000, +m.delay || 0)); return; }
      const max = st.cols * st.rows;
      if (m.t === 'set' && pg && m.k >= 0 && m.k < max) pg.keys[m.k] = clean(m.key || {});
      else if (m.t === 'del' && pg) delete pg.keys[m.k];
      else if (m.t === 'move' && pg && Number.isInteger(m.to) && m.to !== m.p && P()[m.to] && pg.keys[m.k]) {
        // Pindahkan tombol ke slot kosong pertama di halaman tujuan
        const tp = P()[m.to]; let j = -1;
        for (let i = 0; i < max; i++) if (!tp.keys[i]) { j = i; break; }
        if (j < 0) return;
        tp.keys[j] = pg.keys[m.k]; delete pg.keys[m.k];
      }
      else if (m.t === 'swap' && pg && m.a >= 0 && m.b >= 0 && m.a < max && m.b < max) {
        const a = pg.keys[m.a], b = pg.keys[m.b];
        if (b) pg.keys[m.a] = b; else delete pg.keys[m.a];
        if (a) pg.keys[m.b] = a; else delete pg.keys[m.b];
      } else if (m.t === 'addPage' && P().length < 10) P().push({ keys: {} });
      else if (m.t === 'delPage' && pg && P().length > 1) P().splice(m.p, 1);
      else if (m.t === 'addProf' && st.profiles.length < 12) { st.profiles.push({ name: String(m.name || 'Profil').slice(0, 40), pages: [{ keys: {} }] }); st.cur = st.profiles.length - 1; }
      else if (m.t === 'renProf' && st.profiles[m.i]) st.profiles[m.i].name = String(m.name || '').slice(0, 40) || st.profiles[m.i].name;
      else if (m.t === 'delProf' && st.profiles.length > 1 && st.profiles[m.i]) { st.profiles.splice(m.i, 1); st.cur = Math.min(st.cur, st.profiles.length - 1); }
      else return;
      save();
      broadcast();
    });
  });

  server.on('error', (e) => console.error('Server error:', e.message));
  server.listen(port, '0.0.0.0');
  server.autoMic = autoMic;
  return server;
}

module.exports = { start };
