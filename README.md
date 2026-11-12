# SYNC — Personal Life Management

Starter app berbasis React + Vite + TypeScript.

## Cara memasang
1. Ekstrak folder `SYNC_starter` lalu buka terminal di folder tersebut.
2. Jalankan:
   ```bash
   npm install
   npm run dev
   ```
3. Untuk mengecek build:
   ```bash
   npm run build
   ```

Jika ingin memakai proyek React + Vite yang sudah ada, salin `App.tsx`, `App.css`, `Debt.css`, `Responsive.css`, dan `Settings.css` ke folder `src` pada proyek tersebut.

Di PowerShell Windows yang memblokir `npm.ps1`, gunakan `npm.cmd install`, `npm.cmd run dev`, dan `npm.cmd run build`.

## Deploy ke GitHub Pages
Workflow pada `.github/workflows/deploy.yml` membangun dan menerbitkan `dist` saat ada push ke branch `main`. Buat repository GitHub, unggah proyek (tanpa `node_modules` dan `dist`), lalu di **Settings → Pages** pilih **GitHub Actions** sebagai sumber deploy. Setelah workflow pertama berhasil, URL Pages muncul pada halaman deployment repository. Jangan unggah data pengguna atau file rahasia.

## Fitur yang sudah tersedia
- Dashboard ringkasan.
- Catat pemasukan dan pengeluaran.
- Anggaran bulanan.
- Saldo awal dompet dan rekening; saldo berjalan mengikuti transaksi tercatat.
- Catat utang/piutang, nominal, tanggal jatuh tempo, dan status pembayarannya.
- To-do list dan prioritas.
- Habit tracker harian.
- Target tabungan dan penambahan dana.
- Agenda tugas/pengingat mendatang pada dashboard dan daftar kalender.
- Pengingat tersimpan dan uji notifikasi browser.
- Pusat notifikasi lintas modul dengan prioritas, riwayat, dan status baca.
- Pengaturan waktu pengingat harian, jarak pengingat tenggat, dan ambang anggaran.
- Notifikasi browser untuk tagihan, jadwal, anggaran, tugas, kebiasaan, dan target.
- Profil pengguna, tema terang/gelap, dan pilihan warna aksen.
- Kunci aplikasi dengan PIN lokal, batas percobaan buka, dan kunci otomatis saat tidak aktif.
- Ekspor/impor JSON, backup, dan restore data.
- Penghapusan data lokal dan pengaturan privasi.
- Laporan mingguan dan bulanan: arus kas, perkiraan aset, produktivitas, keberhasilan habit, progres target, dan perbandingan periode.
- Penyimpanan otomatis di localStorage.
- Assistant lokal berbasis ringkasan data dan aturan sederhana.

## Catatan penting
- Data disimpan di browser/perangkat ini. Menghapus data situs/browser dapat menghapus data SYNC; lakukan ekspor backup secara berkala.
- PIN melindungi tampilan aplikasi pada perangkat ini, tetapi tidak mengenkripsi isi localStorage. Data dan preferensi di file backup dapat dibaca sebagai JSON; verifier PIN tidak disertakan. Gunakan penguncian perangkat untuk perlindungan tambahan.
- Sesi yang dapat dikunci berlaku untuk profil browser ini; aplikasi offline ini tidak mengelola akun atau sesi lintas perangkat.
- Notifikasi browser berjalan saat SYNC terbuka. Notifikasi push ketika browser atau aplikasi tertutup memerlukan service worker dan server push.
- Laporan hanya memakai riwayat yang tersedia. Pencatatan tugas dan habit dimulai saat penyelesaiannya ditandai; snapshot progres target direkam ketika SYNC dibuka atau data berubah. Nilai aset memperkirakan saldo awal dompet/rekening ditambah transaksi, sehingga masukkan saldo awal dengan benar.
- Transfer rekening, transaksi berulang, Personal Vault, streak/pencapaian, dan pencatatan pembayaran utang ke ledger belum tersedia. Kontribusi target tabungan hanya mengubah progres target, belum memindahkan saldo akun.
- AI Assistant saat ini belum memakai model AI online. Integrasi AI sungguhan memerlukan API dan pengamanan kunci API melalui backend.
