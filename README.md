# Tebak Lagu

Game tebak lagu ala Heardle: dengar potongan lagu dari playlist Spotify, lalu tebak judulnya.
Mulai dari 1 detik; setiap kali dilewati atau salah, potongannya makin panjang (2, 4, 7, 11, 16
detik). Enam kesempatan; makin cepat benar, makin banyak poin (100, 80, 60, 40, 25, 10). Skor
terbaik tersimpan di browser.

- Daftar lagu: playlist Spotify publik mana pun (default **Petro Jam**). Tempel link playlist lain di
  bawah kartu untuk ganti.
- Audio: cuplikan 30 detik resmi dari Deezer (gratis, tanpa login, tanpa API key). Lagu yang tidak
  punya cuplikan di Deezer dilewati otomatis.
- Tebakan: kotak pencarian lagu dari Deezer. Judul dibandingkan longgar ("feat.", versi, aksen, dan
  tanda baca tidak dihitung).

React + Vite. Dua fungsi server kecil di `api/` (Vercel), karena Spotify dan Deezer tidak bisa
dipanggil langsung dari browser:

- `api/playlist.js`: membaca daftar lagu dari halaman embed playlist Spotify (100 lagu pertama).
- `api/deezer.js`: mencari cuplikan lagu dan saran tebakan.

## Menjalankan

```bash
npm install
npm run dev
```

Buka http://localhost:5173 (fungsi `api/` ikut jalan saat dev). Untuk online, import repo ini di
Vercel (framework: Vite); tidak ada environment variable yang perlu diisi.
