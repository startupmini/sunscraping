/**
 * sunscraping — konfigurasi bersama.
 * Dimuat paling awal di setiap permukaan: importScripts() di service worker,
 * <script src> sebelum popup.js / options.js.
 */
const SA_CONFIG = {
  // Harus sama dengan SA_PORT backend; daftar CORS backend juga diturunkan dari situ.
  apiBase: 'http://localhost:5000',
};
