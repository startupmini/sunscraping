'use strict';
/**
 * Only the local backend is ever called: the base URL is fixed by main.js from
 * SA_PORT, and the API key travels in X-API-Key exactly like the extension does.
 */

function createApi({ base, key, timeoutMs = 20000 }) {
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(base + path, {
        ...options,
        headers: { ...(options.headers || {}), 'X-API-Key': key },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error('API key ditolak backend. Hapus backend/.api_key lalu jalankan ulang.');
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async function json(path, options) {
    const response = await request(path, options);
    if (!response.ok) throw new Error(`Backend ${path} gagal (${response.status})`);
    return response.json();
  }

  return {
    async pendingCount() {
      try {
        const stats = await json('/api/stats');
        return (stats.PENDING || 0) + (stats.RUNNING || 0);
      } catch (error) {
        return 0;
      }
    },

    nextTask(preferPlatform) {
      const prefer = preferPlatform === 'instagram' || preferPlatform === 'tiktok'
        ? preferPlatform
        : '';
      return json(`/api/task/next?prefer=${encodeURIComponent(prefer)}`);
    },

    async reportResult(taskId, result) {
      const response = await request('/api/task/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, result }),
      });
      // 404 means the task was already settled (a claim expired and was
      // reclaimed); reporting again would append a snapshot for a visit that
      // never happened.
      if (response.status === 404) return;
      if (!response.ok) throw new Error(`/api/task/result gagal (${response.status})`);
    },

    async reportProfile(profile, fallbackUsername, fallbackPlatform) {
      const payload = {
        ...profile,
        platform: profile.platform || fallbackPlatform,
        username: profile.username || fallbackUsername,
      };
      if (!payload.username || !payload.platform) return;
      const response = await request('/api/account/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`/api/account/profile gagal (${response.status})`);
    },
  };
}

module.exports = { createApi };
