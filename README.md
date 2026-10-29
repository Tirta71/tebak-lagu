# Tebak Lagu

Game tebak lagu ala Heardle: dengar potongan lagu dari playlist Spotify, lalu tebak judulnya.
Mulai dari 15 detik; setiap kali dilewati atau salah, potongannya makin panjang (18, 21, 24, 27,
lalu 30 detik penuh). Ubah panjangnya di `CLIPS` pada `src/App.tsx`. Enam kesempatan; makin cepat benar, makin banyak poin (100, 80, 60, 40, 25, 10). Skor
terbaik tersimpan di browser.

- Daftar lagu: playlist Spotify publik mana pun (default **Petro Jam**). Tempel link playlist lain di
  bawah kartu untuk ganti.
- Audio: cuplikan 30 detik resmi dari Deezer (gratis, tanpa login, tanpa API key). Lagu yang tidak
  punya cuplikan di Deezer dilewati otomatis.
- Setelah ronde selesai: **lirik** lagunya tampil di kartu jawaban, langsung dari API resmi
  Musixmatch (lihat di bawah). Tanpa API key, yang muncul tautan ke liriknya di Musixmatch.
- Tebakan: kotak pencarian lagu dari Deezer. Judul dibandingkan longgar ("feat.", versi, aksen, dan
  tanda baca tidak dihitung).

React + Vite. Dua fungsi server kecil di `api/` (Vercel), karena Spotify dan Deezer tidak bisa
dipanggil langsung dari browser:

- `api/playlist.js`: membaca daftar lagu dari halaman embed playlist Spotify (100 lagu pertama).
- `api/deezer.js`: mencari cuplikan lagu dan saran tebakan.
- `api/lyrics.js`: mengambil lirik dari Musixmatch (butuh API key).

## Lirik (Musixmatch)

1. Daftar di https://developer.musixmatch.com dan ambil API key gratis.
2. Salin `.env.example` menjadi `.env.local` dan isi `MUSIXMATCH_API_KEY`.
3. Untuk online, tambahkan variabel yang sama di Vercel (Settings → Environment Variables).

Paket gratis Musixmatch memberi sebagian lirik saja, untuk pemakaian non-komersial, dan meminta
baris hak cipta serta tracking pixel-nya ikut ditampilkan (sudah ditangani di `LyricsPanel`).
Lirik diambil langsung saat ronde selesai; game ini tidak menyimpan lirik apa pun.

## Menjalankan

```bash
npm install
npm run dev
```

Buka http://localhost:5173 (fungsi `api/` ikut jalan saat dev). Untuk online, import repo ini di
Vercel (framework: Vite); environment variable hanya `MUSIXMATCH_API_KEY` untuk lirik (opsional).
