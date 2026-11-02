/**
 * sunscraping — helper murni yang dipakai bersama content script Instagram dan TikTok.
 * Terdaftar lebih dulu di setiap array content_scripts.js, jadi SA_CONTENT sudah
 * ada saat scraper berjalan. Tanpa efek samping, tanpa akses DOM.
 */
const SA_CONTENT = {
  /**
   * Truncate by code points so emoji (surrogate pairs) are never split.
   * A split surrogate used to crash the backend SQLite writer.
   */
  truncateText(text, maxChars) {
    if (text === null || text === undefined) return null;
    const value = String(text);
    const chars = Array.from(value);
    return chars.length > maxChars ? chars.slice(0, maxChars).join('') : value;
  },
};
