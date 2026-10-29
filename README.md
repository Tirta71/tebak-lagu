# Tebak Lagu

Game tebak lagu ala Heardle: dengar potongan lagu dari playlist Spotify, lalu tebak judulnya.
Mulai dari 15 detik; setiap kali dilewati atau salah, potongannya makin panjang (18, 21, 24, 27,
lalu 30 detik penuh). Ubah panjangnya di `CLIPS` pada `src/App.tsx`. Enam kesempatan; makin cepat benar, makin banyak poin (100, 80, 60, 40, 25, 10). Skor
terbaik tersimpan di browser.

- Daftar lagu: playlist Spotify publik mana pun (default **Petro Jam**). Tempel link playlist lain di
  bawah kartu untuk ganti.
- Audio: cuplikan 30 detik resmi dari Deezer (gratis, tanpa login, tanpa API key). Lagu yang tidak
  punya cuplikan di Deezer dilewati otomatis.
- Setelah ronde selesai: **lirik** lagunya tampil di kartu jawaban lewat embed resmi Genius (lihat
  di bawah). Tanpa token, atau kalau lagunya tidak ada di Genius, yang muncul tautan lirik ke
  Spotify dan Genius.
- Tebakan: kotak pencarian lagu dari Deezer. Judul dibandingkan longgar ("feat.", versi, aksen, dan
  tanda baca tidak dihitung).

React + Vite. Dua fungsi server kecil di `api/` (Vercel), karena Spotify dan Deezer tidak bisa
dipanggil langsung dari browser:

- `api/playlist.js`: membaca daftar lagu dari halaman embed playlist Spotify (100 lagu pertama).
- `api/deezer.js`: mencari cuplikan lagu dan saran tebakan.
- `api/genius.js`: mencari lagu di Genius untuk embed liriknya (butuh access token gratis).

## Lirik (Genius)

Lirik ditampilkan oleh embed resmi Genius, lengkap dengan kredit dan tautan Genius. Game ini hanya
mencari ID lagunya di API Genius dan tidak menyimpan lirik apa pun. Embed-nya berjalan di iframe
yang di-sandbox, jadi script Genius tidak bisa menyentuh halaman game.

1. Buka https://genius.com/api-clients, buat **New API Client** (nama dan URL bebas), lalu klik
   **Generate Access Token**.
2. Salin `.env.example` menjadi `.env.local` dan isi `GENIUS_ACCESS_TOKEN`.
3. Untuk online, tambahkan variabel yang sama di Vercel (Settings → Environment Variables).

## Menjalankan

```bash
npm install
npm run dev
```

Buka http://localhost:5173 (fungsi `api/` ikut jalan saat dev). Untuk online, import repo ini di
Vercel (framework: Vite); environment variable hanya `GENIUS_ACCESS_TOKEN` untuk lirik (opsional).
