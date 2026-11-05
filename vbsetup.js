// Pemasangan VB-Cable otomatis (Windows): unduh dari vb-audio.com, pasang, jadikan mic default,
// ganti nama, dan kembalikan speaker default seperti semula.
// Bagian yang butuh hak administrator (pasang + ganti nama) dijalankan dalam SATU proses dengan satu kali izin UAC.
// Skripnya dicek hash SHA-256 sebelum dijalankan supaya tidak bisa diganti orang lain di tengah jalan.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ---- Kode C# kecil untuk mengatur perangkat suara Windows (kompatibel C# 5 / Windows PowerShell 5.1) ----
const CS = String.raw`using System;
using System.Runtime.InteropServices;
namespace GatitoNS {
  [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicyConfig {
    [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr f);
    [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string n, int d, IntPtr f);
    [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string n);
    [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a, IntPtr b);
    [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string n, int d, IntPtr a, IntPtr b);
    [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a);
    [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a);
    [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a);
    [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string n, int fx, IntPtr k, IntPtr v);
    [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string n, int fx, IntPtr k, IntPtr v);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string n, int role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string n, int v);
  }
  [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyConfigClient {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int f, int m, out IntPtr d);
    [PreserveSig] int GetDefaultAudioEndpoint(int f, int r, out IMMDevice d);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr c);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr c);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, out IntPtr o);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore s);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int s);
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out int c);
    [PreserveSig] int GetAt(int i, out PropKey k);
    [PreserveSig] int GetValue(ref PropKey k, IntPtr v);
    [PreserveSig] int SetValue(ref PropKey k, ref PropVar v);
    [PreserveSig] int Commit();
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
  [StructLayout(LayoutKind.Sequential)] struct PropKey { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVar { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }

  public static class GatitoAudio {
    // flow: 0 = speaker (render), 1 = mic (capture)
    public static string DefaultId(int flow) {
      IMMDeviceEnumerator e = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDevice d;
      if (e.GetDefaultAudioEndpoint(flow, 0, out d) != 0) return "";
      string id;
      d.GetId(out id);
      return id;
    }
    public static int SetDefault(string id) {
      IPolicyConfig p = (IPolicyConfig)new PolicyConfigClient();
      int r = 0;
      for (int i = 0; i < 3; i++) { int x = p.SetDefaultEndpoint(id, i); if (x != 0) r = x; }
      return r;
    }
    public static int Rename(string id, string name) {
      IMMDeviceEnumerator e = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDevice d;
      int h = e.GetDevice(id, out d);
      if (h != 0) return h;
      IPropertyStore s;
      h = d.OpenPropertyStore(1, out s);
      if (h != 0) return h;
      PropKey k = new PropKey();
      k.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
      k.pid = 2;
      PropVar v = new PropVar();
      v.vt = 31;
      v.p = Marshal.StringToCoTaskMemUni(name);
      h = s.SetValue(ref k, ref v);
      if (h == 0) h = s.Commit();
      Marshal.FreeCoTaskMem(v.p);
      return h;
    }
  }
}`;

// ---- Fungsi PowerShell bersama ----
const LIB = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
` + CS + String.raw`
'@
$MM = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio'
function EpName($flow, $id) {
  try {
    $g = ($id -split '\.')[-1]
    $p = Get-ItemProperty ($MM + '\' + $flow + '\' + $g + '\Properties')
    $d = $p.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
    $a = $p.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
    if ($a) { return ($d + ' (' + $a + ')') } else { return [string]$d }
  } catch { return '' }
}
function FindEp($flow, $rx) {
  if ($flow -eq 'Render') { $pre = '{0.0.0.00000000}' } else { $pre = '{0.0.1.00000000}' }
  foreach ($k in (Get-ChildItem ($MM + '\' + $flow) -ErrorAction SilentlyContinue)) {
    try {
      $s = (Get-ItemProperty $k.PSPath).DeviceState
      if ($s -ne 1) { continue }
      $n = EpName $flow $k.PSChildName
      if ($n -match $rx) { return ($pre + '.' + $k.PSChildName) }
    } catch {}
  }
  return ''
}
`;

const q = (s) => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
const CAP_RX = 'CABLE Output|\\(VB-Output\\)';

const SNAP = String.raw`$r = [GatitoNS.GatitoAudio]::DefaultId(0)
$c = [GatitoNS.GatitoAudio]::DefaultId(1)
$o = @{ rid = $r; rname = (EpName 'Render' $r); cid = $c; cname = (EpName 'Capture' $c) }
Write-Output (ConvertTo-Json -Compress -InputObject $o)
`;

const defaultsScript = (rid, rname, loops) => String.raw`$rid = ` + q(rid) + String.raw`
$rname = ` + q(rname) + String.raw`
$res = @{ cap = -1; ren = -1; err = '' }
try {
  for ($i = 0; $i -lt ` + loops + String.raw`; $i++) {
    $cap = FindEp 'Capture' ` + q(CAP_RX) + String.raw`
    if ($cap) { $res.cap = [GatitoNS.GatitoAudio]::SetDefault($cap) }
    if ($rid -and ($rname -notmatch 'CABLE|VB-Audio|VB-Output')) {
      $cur = [GatitoNS.GatitoAudio]::DefaultId(0)
      if ($cur -ne $rid) { $res.ren = [GatitoNS.GatitoAudio]::SetDefault($rid) } else { $res.ren = 0 }
    }
    if ($i -lt ` + (loops - 1) + String.raw`) { Start-Sleep -Seconds 3 }
  }
} catch { $res.err = $_.Exception.Message }
Write-Output (ConvertTo-Json -Compress -InputObject $res)
`;

// Saat Gatito dibuka: catat mic asli (kalau default masih mic asli), lalu jadikan Virtual Mic mic default
const useVirtualScript = String.raw`$res = @{ ok = 0; real = ''; err = '' }
try {
  $cur = [GatitoNS.GatitoAudio]::DefaultId(1)
  $cn = EpName 'Capture' $cur
  if ($cn -and ($cn -notmatch 'CABLE|VB-Audio|VB-Output')) { $res.real = $cn }
  $cap = FindEp 'Capture' ` + q(CAP_RX) + String.raw`
  if ($cap) { if ($cap -ne $cur) { $null = [GatitoNS.GatitoAudio]::SetDefault($cap) }; $res.ok = 1 }
} catch { $res.err = $_.Exception.Message }
Write-Output (ConvertTo-Json -Compress -InputObject $res)
`;

// Saat Gatito ditutup: kembalikan mic asli, tapi hanya kalau default sekarang masih Virtual Mic
const restoreIfVirtScript = (label) => String.raw`$res = @{ ok = 0; skip = 0; err = '' }
try {
  $cur = [GatitoNS.GatitoAudio]::DefaultId(1)
  $cn = EpName 'Capture' $cur
  if ($cn -notmatch 'CABLE|VB-Audio|VB-Output') { $res.skip = 1 } else {
    $id = FindEp 'Capture' ('^' + [regex]::Escape(` + q(label) + String.raw`) + '$')
    if (-not $id) { $res.err = 'notfound' } else { $res.ok = 1; $null = [GatitoNS.GatitoAudio]::SetDefault($id) }
  }
} catch { $res.err = $_.Exception.Message }
Write-Output (ConvertTo-Json -Compress -InputObject $res)
`;

const restoreScript = (label) => String.raw`$res = @{ ok = 0; err = '' }
try {
  $id = FindEp 'Capture' ('^' + [regex]::Escape(` + q(label) + String.raw`) + '$')
  if (-not $id) { $res.err = 'notfound' } else { $res.ok = 1; $null = [GatitoNS.GatitoAudio]::SetDefault($id) }
} catch { $res.err = $_.Exception.Message }
Write-Output (ConvertTo-Json -Compress -InputObject $res)
`;

// Skrip administrator: unduh, pasang, tunggu perangkat muncul, ganti nama. Hasil lewat exit code (bit flag).
const ELEV_BODY = String.raw`$code = 0
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue'
  $dir = ''
  if ($install) {
    $dir = Join-Path $env:SystemRoot ('Temp\GatitoVB_' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $zip = Join-Path $dir 'vb.zip'
    $ok = $false
    foreach ($u in @('https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip', 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack43.zip')) {
      try {
        Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $zip -TimeoutSec 120
        if ((Get-Item $zip).Length -gt 100000) { $ok = $true; break }
      } catch {}
    }
    if (-not $ok) {
      $code = $code -bor 4
    } else {
      $pkg = Join-Path $dir 'pkg'
      Expand-Archive -Path $zip -DestinationPath $pkg -Force
      $all = @(Get-ChildItem -Path $pkg -Recurse -Filter 'VBCABLE_Setup*.exe')
      $arch = $env:PROCESSOR_ARCHITECTURE
      $setup = $null
      if ($arch -eq 'ARM64') { $setup = $all | Where-Object { $_.Name -match 'arm' } | Select-Object -First 1 } elseif ($arch -eq 'AMD64') { $setup = $all | Where-Object { $_.Name -match 'x64' } | Select-Object -First 1 }
      if (-not $setup) { $setup = $all | Where-Object { $_.Name -notmatch 'x64|arm' } | Select-Object -First 1 }
      if (-not $setup) {
        $code = $code -bor 8
      } else {
        Start-Process -FilePath $setup.FullName -ArgumentList '-i', '-h' -WorkingDirectory $setup.DirectoryName -Wait | Out-Null
      }
    }
  }
  $id = ''
  if ($install) { $tries = 60 } else { $tries = 3 }
  for ($i = 0; $i -lt $tries; $i++) {
    $id = FindEp 'Capture' ` + q(CAP_RX) + String.raw`
    if ($id) { break }
    Start-Sleep -Seconds 1
  }
  if (-not $id) {
    $code = $code -bor 16
  } else {
    $code = $code -bor 1
    try { if ([GatitoNS.GatitoAudio]::Rename($id, $name) -eq 0) { $code = $code -bor 2 } } catch {}
  }
} catch {
  $code = $code -bor 32
} finally {
  if ($dir) { Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue }
}
`;

function runPS(script, ms) {
  return new Promise((resolve) => {
    const b64 = Buffer.from('[Console]::OutputEncoding=[Text.Encoding]::UTF8\n' + script, 'utf16le').toString('base64');
    let out = '', err = '', done = false, p;
    const end = (r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => { try { p && p.kill(); } catch (e) {} }, ms);
    try { p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], { windowsHide: true }); }
    catch (e) { return end({ code: -1, out, err: String(e) }); }
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => end({ code: -1, out, err: String(e) }));
    p.on('close', (c) => end({ code: c, out, err }));
  });
}
const lastJson = (s) => { try { const l = String(s).trim().split(/\r?\n/).filter((x) => x.trim().startsWith('{')).pop(); return l ? JSON.parse(l) : null; } catch (e) { return null; } };
const isVirtName = (n) => /vb-audio|vb-output|cable (in|out)/i.test(n || '');

// Kode keluar: bit flag 1..32 untuk hasil kerja; 98 = hash skrip tidak cocok; 99 = UAC ditolak/gagal dijalankan.
// Satu kali UAC: skrip ditulis ke berkas, hash-nya dicek di dalam proses administrator sebelum dijalankan
async function runElevated(install, name, workDir) {
  const text = '$install = ' + (install ? '$true' : '$false') + '\n$name = ' + q(name) + '\n' + LIB + ELEV_BODY;
  fs.mkdirSync(workDir, { recursive: true });
  const file = path.join(workDir, 'elev-' + crypto.randomBytes(6).toString('hex') + '.ps1');
  fs.writeFileSync(file, text, 'utf8');
  const hash = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  try {
    const inner = '$f=' + q(file) + ';$c=[IO.File]::ReadAllText($f,[Text.Encoding]::UTF8);$sha=[Security.Cryptography.SHA256]::Create();' +
      "$h=(($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($c))|ForEach-Object{$_.ToString('x2')}) -join '');" +
      'if($h -ne ' + q(hash) + '){exit 98};Invoke-Expression $c;exit $code';
    const b64 = Buffer.from(inner, 'utf16le').toString('base64');
    const outer = '$a = ' + q('-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + b64) + '\n' +
      'try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList $a -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } catch { exit 99 }';
    return (await runPS(outer, 8 * 60 * 1000)).code;
  } finally { try { fs.unlinkSync(file); } catch (e) {} }
}

let S = { running: false, msg: '', err: '', notes: [], done: false };
const status = () => JSON.parse(JSON.stringify(S));

// opt: { install: bool, mic: label mic asli yang sudah dipilih, engineMic: label dari mesin audio }
async function run(opt) {
  if (S.running) return S;
  S = { running: true, msg: 'Memeriksa pengaturan suara Windows…', err: '', notes: [], done: false };
  const out = { ok: false, snap: null };
  try {
    if (process.platform !== 'win32') throw new Error('Fitur ini hanya untuk Windows.');
    const sn = lastJson((await runPS(LIB + SNAP, 60000)).out) || {};
    out.snap = sn;
    const realMic = opt.mic || (sn.cname && !isVirtName(sn.cname) ? sn.cname : '') || opt.engineMic || 'Microphone';
    const name = (realMic + ' (VB-Output)').replace(/[\u0000-\u001f]/g, '').slice(0, 120);

    S.msg = opt.install
      ? 'Menunggu izin Windows (klik Ya), lalu VB-Cable diunduh dan dipasang. Kalau muncul jendela "Windows Security", klik Install.'
      : 'Menunggu izin Windows (klik Ya)…';
    const code = await runElevated(!!opt.install, name, path.join(process.env.ProgramData || os.tmpdir(), 'GatitoVB'));

    const bad = [];
    if (code === 99) bad.push('Izin administrator dibatalkan atau ditolak. Klik tombolnya lagi lalu pilih Ya.');
    else if (code === 98) bad.push('Pemeriksaan keamanan skrip gagal, proses dihentikan.');
    else if (code < 0) bad.push('PowerShell tidak bisa dijalankan.');
    else {
      if (code & 4) bad.push('VB-Cable gagal diunduh. Cek koneksi internet lalu coba lagi.');
      if (code & 8) bad.push('Installer VB-Cable tidak ditemukan di paket unduhan.');
      if (code & 16) bad.push('VB-Cable belum muncul sebagai perangkat. Restart PC, lalu buka Gatito dan klik "Atur otomatis".');
      if (code & 32) bad.push('Terjadi kesalahan saat pemasangan.');
    }
    const found = code > 0 && code < 64 && (code & 1) === 1;
    if (found && !(code & 2)) S.notes.push('Nama mic virtual tidak bisa diganti (tidak masalah, tetap berfungsi).');

    S.msg = 'Mengatur mic default dan menjaga speaker tetap di perangkatmu…';
    const loops = opt.install ? 4 : 1;
    const df = lastJson((await runPS(LIB + defaultsScript(sn.rid || '', sn.rname || '', loops), 90000)).out) || {};
    const defOk = !df.err && df.cap !== undefined && (!found || df.cap === 0);
    if (df.err) S.notes.push('Default suara Windows tidak bisa diubah otomatis (' + df.err + '). Atur manual di pengaturan suara Windows.');
    else if (df.cap === undefined) S.notes.push('Pengaturan default suara Windows tidak memberi hasil. Atur manual di pengaturan suara Windows.');
    else {
      if (found && df.cap !== 0) S.notes.push('Mic default belum berhasil dipindah ke Virtual Mic. Atur manual di pengaturan suara Windows.');
      if (sn.rname && isVirtName(sn.rname)) S.notes.push('Speaker default Windows sebelumnya sudah berupa CABLE Input, jadi tidak dikembalikan. Pilih speakermu di menu Speaker.');
    }

    if (bad.length) { S.err = bad.join(' '); S.msg = S.err; } else {
      out.ok = true;
      S.msg = defOk
        ? 'Selesai. Mic default Windows sekarang Virtual Mic, speakermu tidak diubah.' + (opt.install ? ' Kalau belum muncul di Discord, restart PC.' : '')
        : 'VB-Cable sudah siap, tetapi default suara Windows belum berhasil diatur otomatis (lihat catatan).';
    }
    out.mic = realMic;
  } catch (e) {
    S.err = String((e && e.message) || e); S.msg = S.err;
  }
  S.running = false; S.done = true;
  return out;
}

// Label dari Chromium kadang berakhiran kode USB "(301a:7c19)" atau diawali "Default - ": buang supaya cocok dengan nama di Windows
const cleanLabel = (l) => String(l || '').replace(/^(Default|Communications) - /i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();

async function useVirtual() {
  if (process.platform !== 'win32') return null;
  return lastJson((await runPS(LIB + useVirtualScript, 60000)).out);
}
async function restoreIfVirtual(label) {
  if (process.platform !== 'win32' || !cleanLabel(label)) return null;
  return lastJson((await runPS(LIB + restoreIfVirtScript(cleanLabel(label)), 60000)).out);
}

async function restoreMic(label) {
  label = cleanLabel(label);
  if (process.platform !== 'win32') return { ok: false, err: 'Hanya untuk Windows.' };
  if (!label) return { ok: false, err: 'Mic asli belum dipilih. Pilih dulu di menu Microphone Device.' };
  const r = lastJson((await runPS(LIB + restoreScript(label), 60000)).out) || {};
  return r.ok ? { ok: true } : { ok: false, err: r.err === 'notfound' ? 'Mic asli tidak ditemukan.' : 'Gagal mengubah default mic.' };
}

module.exports = { run, status, restoreMic, useVirtual, restoreIfVirtual, _t: { CS, LIB, defaultsScript, restoreScript, ELEV_BODY, isVirtName } };
