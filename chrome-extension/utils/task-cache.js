/**
 * sunscraping — task cache
 * Decides whether a queued post can be answered from the numbers a profile
 * visit already produced, instead of loading the post page again.
 *
 * Kept free of chrome.* so it can be unit tested like rate-limiter.js.
 */
const TaskCache = {
  // The backend applies the same window; this guard exists so a stale or
  // hand-crafted /task/next reply cannot make the worker skip a live post.
  MAX_AGE_MS: 12 * 60 * 60 * 1000,

  METRIC_FIELDS: ['likes', 'comments', 'views', 'shares'],

  _hasNumber(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  },

  /**
   * One account visit per cycle is the whole cost model: it is worth doing when
   * the account is not yet visited this cycle and the backend has no fresh
   * follower count for it (it only returns one inside its cache window).
   */
  shouldHarvestAccount(task, harvestedKeys = []) {
    if (!task || !task.username || !task.platform) return false;
    const key = `${String(task.platform).toLowerCase()}:${String(task.username).toLowerCase()}`;
    const seen = typeof harvestedKeys.has === 'function'
      ? harvestedKeys.has(key)
      : Array.isArray(harvestedKeys) && harvestedKeys.indexOf(key) !== -1;
    if (seen) return false;
    return task.cachedFollowerCount === null || task.cachedFollowerCount === undefined;
  },

  /** Same key the backend stores, computed the same way it does. */
  refFromUrl(url) {
    const text = String(url || '');
    const video = text.match(/\/(?:video|photo)\/(\d+)/);
    if (video) return video[1].toLowerCase();
    const shortcode = text.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/);
    return shortcode ? shortcode[1].toLowerCase() : null;
  },

  /**
   * Turn the profile harvest we just made in this tab into the same shape the
   * backend would have handed us, so a post covered by the account visit never
   * needs a navigation of its own. Metrics are read as the profile reported
   * them; unknown stays null.
   */
  fromHarvest(profile, task) {
    if (!profile || !task || !Array.isArray(profile.posts)) return null;
    const ref = this.refFromUrl(task.url);
    if (!ref) return null;

    const post = profile.posts.find((entry) => {
      if (!entry) return false;
      const candidate = entry.id ? String(entry.id).toLowerCase() : this.refFromUrl(entry.url);
      return candidate === ref;
    });
    if (!post) return null;

    return this.resultFromTask({
      platform: task.platform,
      url: task.url,
      username: task.username,
      cachedPost: {
        platform: profile.platform || task.platform,
        username: profile.username || task.username,
        url: post.url || task.url,
        likes: post.likes,
        comments: post.comments,
        views: post.views,
        shares: post.shares,
        followerCount: profile.followerCount,
        caption: post.caption,
        postDate: post.postedAt,
        // Harvested moments ago in this very tab.
        fetchedAt: new Date().toISOString(),
      },
    });
  },

  /**
   * Returns a scraper-shaped result built from the cache, or null when the task
   * has to be visited. `status` is PARTIAL when some metrics are still unknown,
   * so the dashboard never claims a number we did not have.
   */
  resultFromTask(task, nowMs = Date.now()) {
    const cached = task && task.cachedPost;
    if (!cached || typeof cached !== 'object') return null;

    const measured = this.METRIC_FIELDS.filter(field => this._hasNumber(cached[field]));
    if (measured.length === 0) return null;

    const scrapedAt = cached.fetchedAt ? Date.parse(cached.fetchedAt) : NaN;
    if (Number.isNaN(scrapedAt)) return null;
    const age = nowMs - scrapedAt;
    if (age < 0 || age > this.MAX_AGE_MS) return null;

    const complete = this.METRIC_FIELDS.every(field => this._hasNumber(cached[field]));
    const result = {
      status: complete ? 'OK' : 'PARTIAL',
      platform: cached.platform || task.platform || null,
      username: cached.username || task.username || null,
      url: cached.url || task.url,
      likes: this._hasNumber(cached.likes) ? Number(cached.likes) : null,
      comments: this._hasNumber(cached.comments) ? Number(cached.comments) : null,
      views: this._hasNumber(cached.views) ? Number(cached.views) : null,
      shares: this._hasNumber(cached.shares) ? Number(cached.shares) : null,
      followerCount: this._hasNumber(cached.followerCount) ? Number(cached.followerCount) : null,
      postDate: cached.postDate || null,
      caption: cached.caption || null,
      source: 'profile-visit',
      cachedAt: cached.fetchedAt,
    };

    // Views only ever exists for video posts; a photo grid row legitimately has
    // no view counter, so it must not downgrade an otherwise full row to PARTIAL.
    if (!complete && result.views === null && result.likes !== null && result.comments !== null) {
      result.status = 'OK';
      result.viewsMissingReason = 'photo post has no view counter';
    }

    return result;
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TaskCache;
}
