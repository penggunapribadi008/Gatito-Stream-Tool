// Pemantau OBS: terhubung ke obs-websocket v5 (bawaan OBS 28 ke atas) lalu membaca
// status Live dan Rekaman beserta lamanya. Hasilnya dikirim ke HP lewat server.js.
const crypto = require('crypto');
const WebSocket = require('ws');

const DEF = () => ({ on: 0, host: '127.0.0.1', port: 4455, pass: '' });

// Rapikan pengaturan dari editor. Nilai yang tidak diisi memakai nilai lama (old).
const clean = (o, old) => {
  o = o && typeof o === 'object' ? o : {};
  const d = old || DEF();
  const host = typeof o.host === 'string' && /^[A-Za-z0-9.\-]{1,100}$/.test(o.host.trim()) ? o.host.trim() : d.host;
  const port = Number.isInteger(+o.port) && +o.port >= 1 && +o.port <= 65535 ? +o.port : d.port;
  const pass = typeof o.pass === 'string' ? o.pass.slice(0, 200) : d.pass;
  const on = o.on === undefined ? d.on : (o.on === 1 || o.on === true || o.on === '1' ? 1 : 0);
  return { on, host, port, pass };
};

// onChange(state) dipanggil tiap status berubah, dan tiap detik selama Live atau Rekaman berjalan.
// state.link: 'off' (dimatikan) | 'connecting' (OBS belum bisa dihubungi) | 'auth' (password salah) | 'ok'
function create(onChange) {
  let cfg = DEF(), sock = null, poll = null, retry = null, ident = false, gen = 0, last = '';
  const S = { link: 'off', msg: '', live: false, recon: false, liveMs: 0, rec: false, paused: false, recMs: 0, outs: [] };
  const M = { live: false, recon: false, liveMs: 0, rec: false, paused: false, recMs: 0 }; // Live dan Rekaman utama OBS
  const X = new Map(); // semua output OBS (termasuk dari plugin seperti Aitum Vertical)
  let tickN = 0;
  // Jenis output: 'live' (siaran ke layanan), 'rec' (simpan ke file), 'skip' (virtual cam, replay buffer: tidak dihitung)
  const typeOf = (o) => {
    if (/virtualcam|replay/i.test(o.outputKind + ' ' + o.outputName)) return 'skip';
    const f = o.outputFlags;
    if (f && typeof f === 'object' && 'OBS_OUTPUT_SERVICE' in f) return f.OBS_OUTPUT_SERVICE ? 'live' : 'rec';
    return /rtmp|srt|rist|whip|ftl|stream/i.test(o.outputKind + ' ' + o.outputName) ? 'live' : 'rec';
  };
  // Gabungkan output utama dan output plugin: ada yang aktif berarti aktif, durasi diambil yang terlama
  const merge = () => {
    let live = M.live, liveMs = M.liveMs, recon = M.recon, rec = M.rec, recMs = M.recMs;
    for (const o of X.values()) {
      if (!o.active || o.type === 'skip') continue;
      if (o.type === 'live') { live = true; liveMs = Math.max(liveMs, o.ms); recon = recon || o.recon; }
      else { rec = true; recMs = Math.max(recMs, o.ms); }
    }
    S.live = live; S.liveMs = live ? liveMs : 0; S.recon = live && recon; S.rec = rec; S.recMs = rec ? recMs : 0; S.paused = rec && M.paused;
    S.outs = [...X.values()].map((o) => ({ name: o.name, kind: o.kind, type: o.type, active: o.active, ms: o.active ? o.ms : 0 }));
  };
  const emit = (force) => {
    const j = JSON.stringify(S);
    if (!force && j === last) return;
    last = j;
    try { onChange(Object.assign({}, S)); } catch (e) {}
  };
  const reset = () => { M.live = M.recon = M.rec = M.paused = false; M.liveMs = M.recMs = 0; X.clear(); merge(); };
  const stop = () => {
    clearInterval(poll); poll = null; clearTimeout(retry); retry = null; ident = false;
    if (sock) { const s = sock; sock = null; s.removeAllListeners(); s.on('error', () => {}); try { s.terminate(); } catch (e) {} }
  };
  const later = (ms) => { clearTimeout(retry); if (cfg.on) retry = setTimeout(connect, ms); };

  function connect() {
    stop();
    const my = ++gen;
    reset();
    if (!cfg.on) { S.link = 'off'; S.msg = ''; return emit(); }
    S.link = 'connecting'; S.msg = 'Menghubungkan ke OBS…'; emit();
    let w;
    try { w = new WebSocket('ws://' + cfg.host + ':' + cfg.port, 'obswebsocket.json', { handshakeTimeout: 5000 }); }
    catch (e) { S.msg = 'Alamat OBS tidak valid.'; emit(); return later(5000); }
    sock = w;
    const dead = () => gen !== my;
    const ask = (type, id) => w.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id } }));
    const askOut = (name) => w.send(JSON.stringify({ op: 6, d: { requestType: 'GetOutputStatus', requestId: 'o|' + name, requestData: { outputName: name } } }));
    const tick = () => {
      if (!ident || w.readyState !== 1) return;
      ask('GetStreamStatus', 's'); ask('GetRecordStatus', 'r');
      if (tickN++ % 3 === 0) ask('GetOutputList', 'l'); // daftar output dicek ulang tiap 3 detik: plugin bisa membuat output baru saat mulai live
      for (const o of X.values()) if (o.type !== 'skip') askOut(o.name);
    };

    w.on('error', () => {}); // 'close' menyusul dan menangani semuanya
    w.on('message', (raw) => {
      if (dead()) return;
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (m.op === 0) { // Hello -> Identify (dengan jawaban tantangan kalau OBS memakai password)
        const id = { rpcVersion: 1 };
        const a = m.d && m.d.authentication;
        if (a && a.challenge && a.salt) {
          const secret = crypto.createHash('sha256').update(cfg.pass + a.salt).digest('base64');
          id.authentication = crypto.createHash('sha256').update(secret + a.challenge).digest('base64');
        }
        w.send(JSON.stringify({ op: 1, d: id }));
      } else if (m.op === 2) { // Identified
        ident = true; S.link = 'ok'; S.msg = '';
        tick(); poll = setInterval(tick, 1000); emit(true);
      } else if (m.op === 5) { // Event: segarkan langsung saat Live atau Rekaman mulai/berhenti
        const t = m.d && m.d.eventType;
        if (t === 'StreamStateChanged' || t === 'RecordStateChanged') tick();
      } else if (m.op === 7) { // Hasil permintaan
        const d = m.d || {}, r = d.responseData;
        if (!d.requestStatus || !d.requestStatus.result || !r) return;
        const ms = Math.max(0, Math.round(+r.outputDuration || 0));
        if (d.requestType === 'GetStreamStatus') { M.live = !!r.outputActive; M.recon = M.live && !!r.outputReconnecting; M.liveMs = M.live ? ms : 0; }
        else if (d.requestType === 'GetRecordStatus') { M.rec = !!r.outputActive; M.paused = M.rec && !!r.outputPaused; M.recMs = M.rec ? ms : 0; }
        else if (d.requestType === 'GetOutputList' && Array.isArray(r.outputs)) {
          const names = new Set();
          for (const o of r.outputs) {
            if (!o || typeof o.outputName !== 'string') continue;
            names.add(o.outputName);
            const old = X.get(o.outputName), type = typeOf(o);
            if (old) { old.kind = o.outputKind || ''; old.type = type; }
            else { X.set(o.outputName, { name: o.outputName, kind: o.outputKind || '', type, active: false, recon: false, ms: 0 }); if (type !== 'skip') askOut(o.outputName); }
          }
          for (const n of [...X.keys()]) if (!names.has(n)) X.delete(n);
        } else if (d.requestType === 'GetOutputStatus' && String(d.requestId).startsWith('o|')) {
          const o = X.get(String(d.requestId).slice(2));
          if (o) { o.active = !!r.outputActive; o.recon = o.active && !!r.outputReconnecting; o.ms = o.active ? ms : 0; }
        }
        merge(); emit();
      }
    });
    w.on('close', (code) => {
      if (dead()) return;
      clearInterval(poll); poll = null; ident = false; sock = null; reset();
      if (code === 4009) { S.link = 'auth'; S.msg = 'OBS meminta password, atau password yang diisi salah.'; }
      else { S.link = 'connecting'; S.msg = 'OBS belum terbuka, atau WebSocket Server di OBS belum diaktifkan. Mencoba lagi…'; }
      emit(); later(code === 4009 ? 10000 : 4000);
    });
  }

  return {
    configure(c) { cfg = Object.assign(DEF(), c); connect(); },
    state: () => Object.assign({}, S),
    close() { cfg.on = 0; stop(); }
  };
}

module.exports = { create, clean, DEF };
