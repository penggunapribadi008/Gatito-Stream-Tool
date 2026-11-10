# Gatito: Stream Tool 2.5.8

## Yang baru di 2.5.8
- **Scroll di HP tidak lagi memencet tombol.** Di jendela Tombol virtual, tombol hanya terkirim kalau jari diangkat tanpa bergeser. Tombol juga tidak menyala biru saat jari hanya menggeser. **Pasang apk-hp yang baru.**
- **Tombol virtual (F13 sampai F24) sekarang ikut mengirim kode scan.** Sebelumnya hanya OBS yang mengenali, sedangkan Discord, game, dan aplikasi berbasis browser bisa mengabaikannya. Kalau aplikasi tujuan dijalankan sebagai **Administrator**, jalankan Gatito sebagai Administrator juga (klik kanan, Run as administrator), karena Windows memblokir tombol dari program biasa ke program Administrator.
- **Indikator OBS di HP diringkas.** Bentuknya sekarang `LIVE` dan `REC` (redup kalau belum jalan), dan jadi `LIVE 00:12:34` kalau aktif. Peringatan kuning cuma satu kalimat pendek: `OBS terputus` atau `Password salah`.
- **Logo OBS asli** dipakai di tombol OBS di Gatito.
- **Nama file build:** `gatito-stream-tool-vX.X.X.exe` dan `gatito-stream-tool-vX.X.X.apk`, versinya mengikuti `version` di package.json. Di halaman Actions GitHub, file bisa diunduh langsung tanpa zip.
- **Sidebar paling bawah menampilkan versi**, dengan tombol **Cek update** di ujungnya. Tombol itu mengecek rilis terbaru di GitHub. Supaya berfungsi, buat Release di GitHub dengan tag seperti `v2.5.9`. Kalau belum ada rilis, tampil "Belum ada rilis di GitHub".
- Versi di pengaturan HP sekarang mengikuti versi aplikasi (sebelumnya tertulis 1.9.0).

## Yang baru di 2.5.7
- **Tombol Suara, OBS, Tombol virtual, dan QR jadi ikon saja.** Ubah nama dan Hapus profil juga jadi ikon (pensil dan tempat sampah). Di HP, tombol Tombol virtual juga jadi ikon.
- **Hapus halaman, hapus profil** sekarang pakai ikon tempat sampah dan meminta konfirmasi di dalam aplikasi (bukan jendela bawaan browser). Di HP, alert dan prompt juga diganti dialog di dalam aplikasi.
- **Pindah tombol antar halaman:** seret tombol ke nomor halaman di bawah grid (misalnya dari halaman 1 ke angka 2). Tombol masuk ke slot kosong pertama di halaman itu.
- **Tab Terpakai** di jendela Tombol virtual tidak lagi menampilkan kotak F dan K, hanya daftar yang terpakai.
- **Jendela Suara diringkas** jadi dua kolom, dan kata-katanya tidak lagi menyebut satu aplikasi tertentu.
- **Jendela OBS** memakai langkah bernomor yang singkat.
- **HP:** tombol kembali Android menutup jendela yang terbuka, lalu mundur satu halaman, dan baru keluar aplikasi dari halaman 1. Panah kembali di atas jendela dihapus. Garis kuning saat menyentuh kolom dihilangkan. Profil yang aktif diberi warna, tanpa centang. **Pasang apk-hp yang baru.**

## Yang baru di 2.5.6
- **Pantau OBS membaca semua output**, bukan hanya Live/Rekaman utama. Output dari plugin (misalnya Aitum Vertical) ikut dihitung: kalau salah satunya aktif, LIVE atau REC di HP menyala. Daftar output yang terbaca tampil di jendela OBS Gatito.

## Yang baru di 2.5.5
- **Mic otomatis kembali.** Saat Gatito dibuka, Virtual Mic jadi mic default Windows. Saat Gatito ditutup (Keluar di tray atau tombol X), mic asli dikembalikan otomatis. Di Discord, atur **Input Device ke Default** (bukan memilih CABLE Output langsung) supaya ikut berpindah. Bisa dimatikan lewat kotak centang di jendela Suara. Catatan: kalau Gatito crash, di-kill lewat Task Manager, atau PC dimatikan saat Gatito masih menyala, mic belum sempat dikembalikan. Klik **Kembalikan ke mic asli** atau buka Gatito lagi.
- **Slider sekarang mentok.** Di 100% (atau 200%) bulatan slider tepat di ujung, dan warna isinya mengikuti posisi.
- **Volume per tombol menampilkan persen**, dan nilai 0% sekarang benar-benar 0% (sebelumnya dianggap 80%).
- **Pantau OBS di HP.** Tombol **OBS** di Gatito: aktifkan, lalu di HP muncul status LIVE dan REC beserta lamanya (atau "belum mulai"). Di OBS: Tools > WebSocket Server Settings > Enable WebSocket server (OBS 28 ke atas). Isi password di Gatito kalau OBS memakainya. **Pasang apk-hp yang baru.**
- Tombol "Kembalikan ke mic asli" kini juga bekerja untuk mic USB yang namanya berakhiran kode seperti (301a:7c19).

## Sebelumnya (2.5.4)
- Port server (bawaan 3000) sekarang bisa diubah: klik tombol QR (Sambungkan HP), ubah angka setelah titik dua pada kolom Alamat, klik **Simpan port**, lalu **Mulai ulang**. Port yang sudah dipakai program lain ditolak dengan peringatan `localhost:XXXX telah digunakan`. Tombol **Hindari** menampilkan daftar port yang sebaiknya tidak dipakai.
- Kalau port yang tersimpan ternyata sedang dipakai program lain saat Gatito dibuka, Gatito memberi peringatan dan sementara memakai port kosong berikutnya.
- Setelah port diganti, HP perlu scan QR lagi. Pasang apk-hp yang baru supaya alamat cadangan di QR ikut memakai port baru.
- Tombol virtual di HP sekarang hanya terkirim saat ditap. Menggeser jari untuk scroll tidak lagi memencet tombol. **APK ikut berubah, jadi pasang apk-hp yang baru.**
- Status di jendela Suara diringkas jadi satu baris.
- Volume soundboard ke teman dan volume per tombol bisa sampai 200%.
- Tombol virtual, kode QR (Sambungkan HP), dan daftar pilihan aplikasi sekarang muncul di dalam jendela Gatito, tidak lagi sebagai jendela terpisah.
- Jendela **Suara** bisa memasang VB-Cable sendiri, menjadikannya mic default Windows, dan menjaga speaker tetap di perangkatmu.

## Pakai soundboard di Discord, Roblox, dan game lain
1. Buka Gatito, klik **Suara**.
2. Belum punya VB-Cable: klik **Pasang VB-Cable otomatis**. Sudah terpasang: klik **Atur otomatis**.
3. Saat muncul izin Windows, klik **Ya**. Kalau muncul jendela "Windows Security" untuk driver, klik **Install**. Windows memang selalu menanyakan ini untuk driver audio.
4. Klik **Tes suara**. Di Discord atau game, mic otomatis memakai Virtual Mic karena sudah jadi default Windows.

## Penting
- Gatito harus tetap menyala (minimize saja, jangan klik Keluar). Selama Gatito mati, Virtual Mic kosong, tapi mic default Windows otomatis kembali ke mic asli saat Gatito ditutup.
- Kalau mau memakai mic asli tanpa Gatito, klik **Kembalikan ke mic asli** di jendela Suara.
- VB-Cable adalah donationware dari vb-audio.com. Gatito mengunduhnya langsung dari situs resmi mereka.

## Cara pasang update
1. Upload semua isi folder ini ke GitHub, **termasuk folder .github** (kali ini build.yml berubah), lalu Commit changes.
2. Tunggu build selesai, lalu download file `gatito-stream-tool-vX.X.X.exe` dan `.apk` dari halaman Actions. Tidak perlu diekstrak.
3. PC: TUTUP dulu Gatito yang lama lewat ikon tray (klik kanan, Keluar), baru pasang installer baru.
4. HP: pasang APK baru, karena tombol virtual dan indikator OBS di HP berubah.
