# Tebak Lagu

Kuis tebak lagu: pilih kuis, lalu 10 lagu diputar satu per satu. Untuk tiap lagu, pilih judulnya
dari 4 pilihan dalam 15 detik. Makin cepat benar, makin besar poinnya (1000 kalau langsung, turun
sampai 300 di detik terakhir). Di akhir ada skor, jumlah benar, rekap 10 lagu (dengan tautan Spotify
dan lirik), dan skor terbaik per kuis yang tersimpan di browser.

- **Kuis:** Pilihan Tirta (playlist Petro Jam, Hits Indonesia), playlist Spotify mana pun (tempel
  link), artis (daftar pilihan + cari artis apa saja), genre, dan dekade (70an sampai 2020an).
- **Profil:** avatar dan nama panggilan, tersimpan di browser.
- **Main bareng teman:** belum ada (butuh layanan real-time, misalnya Supabase).
- Audio dari cuplikan 30 detik resmi Deezer (gratis, tanpa key). Lagu tanpa cuplikan dilewati.

Fungsi server di `api/` (Vercel):

- `api/catalog.js`: artis pilihan, genre, dekade, dan pencarian artis (Deezer).
- `api/quiz.js`: lagu untuk satu kuis (chart genre, lagu teratas artis, playlist editor per dekade,
  atau playlist Spotify yang dicocokkan ke Deezer).
- `api/playlist.js`: daftar lagu dari playlist Spotify publik.
- `api/deezer.js`: mencocokkan satu lagu ke Deezer.
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
