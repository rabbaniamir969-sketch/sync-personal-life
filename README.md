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

## Android dan SYNC Life Widget

Proyek ini memakai Capacitor 8 dan menyediakan aplikasi Android native dengan
Home Screen AppWidget. Kode web tetap dapat dijalankan di browser tanpa Android
bridge:

```powershell
npm.cmd install
npm.cmd run dev
```

### Build APK debug

Persyaratan build Android: Android Studio dengan Android SDK API 36, Android
Build Tools, dan JDK 21 (direkomendasikan). Gradle 8.14.3 pada proyek ini
mendukung JDK 21–24; JDK 17 terlalu lama dan JDK 25 terlalu baru. Cek lingkungan
Java sebelum build:

```powershell
npm.cmd run android:check
```

Jika perintah di atas gagal, instal JDK 21 lalu set `JAVA_HOME` ke folder JDK,
seperti berikut:

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
```

Setelah Java siap, buka proyek native di Android Studio:

```powershell
npm.cmd run build
npm.cmd run android:prepare
npm.cmd run android:open
```

Atau build APK debug dari PowerShell:

```powershell
npm.cmd run build
npm.cmd run android:prepare
Set-Location android
.\gradlew.bat assembleDebug
```

APK debug akan berada di
`android\app\build\outputs\apk\debug\app-debug.apk`. Pasang ke perangkat
Android yang terhubung dengan ADB:

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Build APK rilis memerlukan signing key milik pengembang; jangan memasukkan
keystore atau kata sandi ke repository.

### Memasang dan mengatur widget

1. Buka aplikasi **SYNC Personal Life** setidaknya sekali.
2. Dari SYNC, buka **Pengaturan → Widget Customization**. Pilih modul, urutan,
   ukuran, jumlah item, prioritas, frekuensi refresh, dan informasi sensitif.
3. Kembali ke Home Screen, tekan lama area kosong, pilih **Widgets → SYNC Life
   Widget**, lalu letakkan dan ubah ukurannya.
4. Tombol widget membuka formulir tugas, kalender, keuangan, atau pengingat di
   aplikasi SYNC. Widget menandai waktu snapshot terakhir; Android dapat
   menunda pekerjaan berkala sesuai kebijakan baterai.

Widget membaca data dari aplikasi SYNC Android yang sama. `localStorage` Chrome
dan `localStorage` di WebView aplikasi Android terpisah; tidak ada sinkronisasi
otomatis Chrome-ke-APK atau backend. Untuk memindahkan data yang sudah ada di
Chrome, ekspor backup JSON dari browser lalu pulihkan backup itu di aplikasi
Android. Data widget hanyalah snapshot cache native privat; localStorage SYNC
tetap menjadi sumber data utama. Informasi finansial disamarkan secara default,
dan Android auto-backup dinonaktifkan untuk data aplikasi.

Tombol tandai tugas selesai belum disediakan: perubahan aman harus ditulis
melalui state/localStorage SYNC, bukan hanya mengubah cache widget. Buka tugas
melalui widget dan tandai selesai di aplikasi.

### Pemecahan masalah widget

- Jika widget meminta sinkronisasi, buka aplikasi SYNC dengan profil data yang
  benar dan tunggu pembaruan; periksa pesan sinkronisasi pada halaman preview.
- Jika pengaturan berubah tetapi widget belum ikut berubah, buka ulang aplikasi
  dan periksa pembatasan aktivitas latar belakang/baterai Android.
- Refresh widget mengikuti interval minimal 15 menit; WorkManager dapat menunda
  pembaruan demi kebijakan daya Android.
- Jika nominal privat masih terlihat pada preview, nonaktifkan **Tampilkan
  nominal sensitif**. Data lokal dan snapshot native tidak dienkripsi; gunakan
  penguncian perangkat Android.
- Jika APK tidak dapat dibangun, pastikan JDK dan Android SDK API 36 terpasang
  dan `JAVA_HOME` menunjuk ke JDK yang valid.

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
- Target tabungan dan penambahan dana, tandai target tercapai, aktifkan kembali target, dan hapus target.
- Agenda tugas/pengingat mendatang pada dashboard dan daftar kalender.
- Pengingat tersimpan dan uji notifikasi browser.
- Pusat notifikasi lintas modul dengan prioritas, riwayat, dan status baca.
- Pengaturan waktu pengingat harian, jarak pengingat tenggat, dan ambang anggaran.
- Notifikasi browser untuk tagihan, jadwal, anggaran, tugas, kebiasaan, dan target.
- Profil pengguna, tema terang/gelap, dan pilihan warna aksen.
- Kunci aplikasi dengan PIN lokal, batas percobaan buka, dan kunci otomatis saat tidak aktif.
- Ekspor data ke Excel, serta backup dan pemulihan data melalui JSON.
- Penghapusan data lokal dan pengaturan privasi.
- Laporan mingguan dan bulanan: arus kas, perkiraan aset, produktivitas, keberhasilan habit, progres target, dan perbandingan periode.
- Penyimpanan otomatis di localStorage.
- Assistant lokal berbasis ringkasan data dan aturan sederhana.

## Catatan penting
- Data disimpan di browser/perangkat ini. Menghapus data situs/browser dapat menghapus data SYNC; buat backup JSON secara berkala. Ekspor Excel ditujukan untuk melihat dan mengolah data, sedangkan pemulihan ke aplikasi tetap menggunakan backup JSON.
- PIN melindungi tampilan aplikasi pada perangkat ini, tetapi tidak mengenkripsi isi localStorage. Data dan preferensi di file backup dapat dibaca sebagai JSON; verifier PIN tidak disertakan. Gunakan penguncian perangkat untuk perlindungan tambahan.
- Sesi yang dapat dikunci berlaku untuk profil browser ini; aplikasi offline ini tidak mengelola akun atau sesi lintas perangkat.
- Notifikasi browser berjalan saat SYNC terbuka. Notifikasi push ketika browser atau aplikasi tertutup memerlukan service worker dan server push.
- Laporan hanya memakai riwayat yang tersedia. Pencatatan tugas dan habit dimulai saat penyelesaiannya ditandai; snapshot progres target direkam ketika SYNC dibuka atau data berubah. Nilai aset memperkirakan saldo awal dompet/rekening ditambah transaksi, sehingga masukkan saldo awal dengan benar.
- Transfer rekening, transaksi berulang, Personal Vault, streak/pencapaian, dan pencatatan pembayaran utang ke ledger belum tersedia. Kontribusi target tabungan hanya mengubah progres target, belum memindahkan saldo akun.
- AI Assistant saat ini belum memakai model AI online. Integrasi AI sungguhan memerlukan API dan pengamanan kunci API melalui backend.
