// Gatito: Stream Tool (PC): editor + server untuk HP
const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { start } = require('./server');
let PORT = 3000, WANTED = 3000;
const net = require('net');
const ICON = path.join(__dirname, 'build', 'icon.png');
let win = null, vpad = null, tray = null, srv = null, quitting = false;
process.on('uncaughtException', (e) => console.error(e));
// Jaga jendela audio tersembunyi tetap hidup: tanpa ini Windows/Chromium bisa menidurkannya dan suara berhenti
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.setPath('userData', path.join(app.getPath('appData'), 'Gatito Stream Tool'));
// Port server lokal: bawaan 3000, bisa diubah dari jendela Sambungkan HP (disimpan di port.json)
const PORTF = path.join(app.getPath('userData'), 'port.json');
try { const j = JSON.parse(fs.readFileSync(PORTF, 'utf8')); if (Number.isInteger(j.port) && j.port >= 1024 && j.port <= 65535) PORT = j.port; } catch (e) {}
WANTED = PORT;
const portFree = (p) => new Promise((r) => { const t = net.createServer(); t.once('error', () => r(false)); t.once('listening', () => t.close(() => r(true))); t.listen(p, '0.0.0.0'); });

// Pulihkan profil dan tombol dari folder versi lama kalau folder baru masih kosong atau hanya berisi contoh bawaan
function migrate() {
  const base = app.getPath('appData'), dir = app.getPath('userData'), file = path.join(dir, 'deck2.json');
  const info = (f) => {
    try {
      const txt = fs.readFileSync(f, 'utf8'), j = JSON.parse(txt);
      const pages = j.profiles ? j.profiles.flatMap((p) => p.pages) : (j.pages || []);
      const n = pages.reduce((s, pg) => s + Object.keys(pg.keys || {}).length, 0);
      return { n, sample: n === 14 && txt.includes('"Mulai Stream"'), t: fs.statSync(f).mtimeMs };
    } catch (e) { return null; }
  };
  const cur = info(file);
  if (cur && cur.n > 0 && !cur.sample) return;
  let best = null;
  for (const nm of ['StreamDeck HP', 'streamdeck-hp', 'Gatito Stream Tool', 'gatito-stream-tool', 'Gatito']) {
    const d = path.join(base, nm);
    if (path.resolve(d) === path.resolve(dir)) continue;
    for (const fn of ['deck2.json', 'deck2.json.bak']) {
      const i = info(path.join(d, fn));
      if (i && i.n > 0 && !i.sample && (!best || i.t > best.t)) best = { t: i.t, d, fn };
    }
  }
  if (!best) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(best.d, best.fn), file);
  const im = path.join(best.d, 'images');
  if (fs.existsSync(im)) fs.cpSync(im, path.join(dir, 'images'), { recursive: true });
}

const showMain = () => { if (!win) return; win.show(); if (win.isMinimized()) win.restore(); win.focus(); };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showMain);
  app.whenReady().then(init);
}

async function init() {
  if (!(await portFree(PORT))) {
    const old = PORT; let p = PORT + 1;
    while (p < PORT + 50 && !(await portFree(p))) p++;
    PORT = p;
    dialog.showMessageBox({ type: 'warning', title: 'Gatito: Stream Tool', message: `localhost:${old} telah digunakan program lain.`, detail: `Gatito sementara memakai localhost:${p}. HP yang sudah tersambung perlu scan QR lagi. Untuk menetapkan port lain, buka tombol QR (Sambungkan HP) lalu ubah angka port-nya.` }).catch(() => {});
  }
  boot();
}

function boot() {
  // Jendela tersembunyi untuk memutar suara tombol soundboard lewat speaker atau headset
  const audio = new BrowserWindow({ show: false, webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false } });
  audio.webContents.setAudioMuted(false);
  const aurl = `http://127.0.0.1:${PORT}/audiohost`;
  const js = (code) => audio.webContents.executeJavaScript(code).catch((e) => console.error('audio:', e && e.message));
  const closeV = () => { if (vpad && !vpad.isDestroyed()) vpad.close(); vpad = null; };

  const hooks = {
    pickAudio: async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }] });
      return r.canceled ? null : r.filePaths[0];
    },
    pickImage: async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Gambar dan GIF', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] }] });
      if (r.canceled) return null;
      const f = r.filePaths[0];
      if (/\.gif$/i.test(f)) {
        const d = fs.readFileSync(f);
        if (d.length > 6e6) { dialog.showErrorBox('GIF terlalu besar', 'Ukuran GIF maksimal 6 MB.'); return null; }
        return { data: d, ext: 'gif' };
      }
      let im = nativeImage.createFromPath(f);
      const s = im.getSize(), m = Math.min(s.width, s.height);
      if (!m) return null;
      im = im.crop({ x: Math.floor((s.width - m) / 2), y: Math.floor((s.height - m) / 2), width: m, height: m }).resize({ width: 144, height: 144 });
      return { data: im.toPNG(), ext: 'png' };
    },
    play: (id, file, vol) => {
      let mt = 0; try { mt = Math.floor(fs.statSync(file).mtimeMs); } catch (e) {}
      return js(`window.sdplay(${JSON.stringify(id)},${JSON.stringify('/snd?m=' + mt + '&f=' + encodeURIComponent(file))},${vol})`);
    },
    stop: () => js('window.sdstop()'),
    // Pengaturan mikrofon virtual (mesin ada di audio.html)
    audioCfg: (c, force) => js(`window.sdapply(${JSON.stringify(c)},${force ? 'true' : 'false'})`),
    audioInfo: () => js('window.sdInfo()'),
    audioLevel: () => js('window.sdLevel()'),
    audioTest: () => js('window.sdtest()'),
    openVPad: () => {
      if (vpad && !vpad.isDestroyed()) return closeV();
      vpad = new BrowserWindow({ width: 340, height: 240, useContentSize: true, frame: false, title: 'Tombol virtual', alwaysOnTop: true, focusable: false, resizable: false, skipTaskbar: true, backgroundColor: '#1e1f22', icon: ICON });
      vpad.on('closed', () => { vpad = null; });
      vpad.loadURL(`http://127.0.0.1:${PORT}/vpad`);
    },
    closeVPad: closeV,
    openUrl: (u) => { if (/^https:\/\/github\.com\//.test(String(u))) shell.openExternal(String(u)); },
    wantedPort: () => WANTED,
    savePort: (p) => fs.writeFileSync(PORTF, JSON.stringify({ port: p })),
    relaunch: () => { app.relaunch(); app.exit(0); }
  };
  try { migrate(); } catch (e) { console.error(e); }
  srv = start(path.join(app.getPath('userData'), 'deck2.json'), PORT, hooks);
  // Setelah mesin suara siap, jadikan Virtual Mic sebagai mic default Windows (kalau opsinya aktif)
  setTimeout(() => srv.autoMic.on().catch((e) => console.error('automic:', e)), 3000);

  audio.webContents.on('did-fail-load', () => setTimeout(() => audio.loadURL(aurl), 500));
  audio.loadURL(aurl);

  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1000, height: 760, minWidth: 860, minHeight: 600, title: 'Gatito: Stream Tool', backgroundColor: '#1e1f22', icon: ICON });
  const url = `http://127.0.0.1:${PORT}/editor`;
  win.webContents.on('did-fail-load', () => setTimeout(() => win.loadURL(url), 500));
  win.on('minimize', () => win.hide());
  win.on('closed', () => app.quit());
  win.loadURL(url);

  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Gatito: Stream Tool');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Buka Gatito', click: showMain }, { label: 'Keluar', click: () => app.quit() }]));
  tray.on('click', showMain);
}
app.on('window-all-closed', () => app.quit());
// Saat Gatito ditutup, kembalikan mic default Windows ke mic asli supaya Discord tidak kehilangan suara
app.on('before-quit', (e) => {
  if (quitting || !srv || !srv.autoMic) return;
  quitting = true; e.preventDefault();
  const fin = () => app.exit(0);
  Promise.race([srv.autoMic.off().catch((x) => console.error('automic:', x)), new Promise((r) => setTimeout(r, 6000))]).then(fin, fin);
});
