/**
 * sunscraping — Instagram Content Script
 * Membaca data postingan dari halaman Instagram yang sudah dirender browser.
 * Dijalankan di dalam tab Instagram via chrome.scripting.executeScript
 */

(function() {
  'use strict';

  /**
   * Utility: parse angka dari text Instagram (e.g., "1,234", "12.5K", "1.2M")
   */
  function parseCount(text) {
    if (text === null || text === undefined) return null;
    if (typeof text === 'number') return text;
    text = text.toString().trim().toLowerCase();
    
    // Konversi suffix Indonesia ke English
    text = text.replace(/ribu|rb/g, 'k').replace(/juta|jt/g, 'm').replace(/miliar/g, 'b');

    const match = text.match(/([\d.,]+)\s*([kmb])?/i);
    if (match) {
      const num = parseLocaleNumber(match[1], !!match[2]);
      if (num === null) return null;
      const multipliers = { 'k': 1000, 'm': 1000000, 'b': 1000000000 };
      const mult = multipliers[match[2]] || 1;
      return Math.round(num * mult);
    }

    const num = parseLocaleNumber(text.replace(/[^\d.,]/g, ''), false);
    return num === null ? null : Math.round(num);
  }

  /**
   * Truncate by code points so emoji (surrogate pairs) are never split.
   * A split surrogate used to crash the backend SQLite writer.
   */
  function truncateText(text, maxChars) {
    if (text === null || text === undefined) return null;
    const value = String(text);
    const chars = Array.from(value);
    return chars.length > maxChars ? chars.slice(0, maxChars).join('') : value;
  }

  function parseLocaleNumber(value, hasSuffix) {
    if (!value) return null;

    let normalized = value.toString().trim().replace(/\s/g, '');
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');

    if (hasComma && hasDot) {
      const lastComma = normalized.lastIndexOf(',');
      const lastDot = normalized.lastIndexOf('.');
      const decimalSep = lastComma > lastDot ? ',' : '.';
      const thousandsSep = decimalSep === ',' ? '.' : ',';
      normalized = normalized.replace(new RegExp(`\\${thousandsSep}`, 'g'), '').replace(decimalSep, '.');
    } else if (hasComma || hasDot) {
      const sep = hasComma ? ',' : '.';
      const parts = normalized.split(sep);
      const lastPart = parts[parts.length - 1];
      const shouldTreatAsDecimal = hasSuffix && lastPart.length <= 2;

      if (shouldTreatAsDecimal) {
        normalized = parts.slice(0, -1).join('') + '.' + lastPart;
      } else {
        normalized = parts.join('');
      }
    }

    const num = parseFloat(normalized);
    return isNaN(num) ? null : num;
  }

  /**
   * Wait for element to appear in DOM
   */
  function waitForSelector(selector, timeout = 8000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  /**
   * Strategy 1: The most reliable for Instagram is the <meta name="description"> tag!
   * Example: <meta name="description" content="1,234 Likes, 56 Comments - Username (@explorejember_) on Instagram: &quot;Caption...&quot;" />
   */
  function extractFromMetaTags() {
    const result = { likes: null, comments: null, views: null, username: null };
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      const content = metaDesc.getAttribute('content') || '';
      
      // Pattern: "1,234 Likes"
      const likesMatch = content.match(/([\d,.]+[KkMmBb]?)\s*Likes?/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Suka/i);
      if (likesMatch) result.likes = parseCount(likesMatch[1]);

      // Pattern: "56 Comments"
      const commentsMatch = content.match(/([\d,.]+[KkMmBb]?)\s*Comments?/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Komentar/i);
      if (commentsMatch) result.comments = parseCount(commentsMatch[1]);

      // Pattern: "12K Views" (for videos/reels)
      const viewsMatch = content.match(/([\d,.]+[KkMmBb]?)\s*Views?/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Tayangan/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Plays?/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Pemutaran/i) || content.match(/([\d,.]+[KkMmBb]?)\s*kali\s+diputar/i);
      if (viewsMatch) result.views = parseCount(viewsMatch[1]);

      // Pattern: "(@username)"
      const userMatch = content.match(/\(@([a-zA-Z0-9_.-]+)\)/);
      if (userMatch) result.username = userMatch[1];
    }
    return result;
  }

  const VIEW_COUNT_KEYS = [
    'play_count',
    'playCount',
    'video_play_count',
    'videoPlayCount',
    'video_view_count',
    'videoViewCount',
    'ig_play_count',
    'igPlayCount',
    'clips_play_count',
    'clipsPlayCount',
    'fb_play_count',
    'fbPlayCount',
    'organic_play_count',
    'organicPlayCount',
    'view_count',
    'viewCount',
  ];
  const VIEW_COUNT_KEY_SET = new Set(VIEW_COUNT_KEYS.map(normalizeObjectKey));
  const VIEW_TEXT_PATTERN = /([\d,.]+(?:\s*(?:[KkMmBb]|rb|ribu|jt|juta|miliar))?)\s*(?:views?|plays?|tayangan|pemutaran|ditonton|kali\s+diputar|diputar)\b/i;

  function normalizeObjectKey(key) {
    return key.toString().replace(/[_-]/g, '').toLowerCase();
  }

  function isViewCountKey(key) {
    return VIEW_COUNT_KEY_SET.has(normalizeObjectKey(key));
  }

  function getShortcodeFromUrl(url) {
    try {
      const path = new URL(url, window.location.origin).pathname;
      const match = path.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
      return match ? match[1] : null;
    } catch (e) {
      const match = (url || '').match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
      return match ? match[1] : null;
    }
  }

  function shortcodeToMediaId(shortcode) {
    if (!shortcode || typeof BigInt === 'undefined') return null;

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let mediaId = 0n;

    for (const char of shortcode) {
      const value = alphabet.indexOf(char);
      if (value < 0) return null;
      mediaId = mediaId * 64n + BigInt(value);
    }

    return mediaId.toString();
  }

  function getCookieValue(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function isVideoOrReelUrl(url) {
    try {
      const path = new URL(url, window.location.origin).pathname.toLowerCase();
      return /\/reel\//.test(path) || /\/reels\//.test(path) || /\/tv\//.test(path);
    } catch (e) {
      return /\/reel\//i.test(url) || /\/reels\//i.test(url) || /\/tv\//i.test(url);
    }
  }

  /**
   * Find the JSON node that belongs to the requested shortcode/media id.
   * Scoping by the target is important: taking the max play_count from the
   * whole response also picks up suggested/related reels.
   */
  function findMediaNode(obj, mediaId, shortcode, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 14) return null;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findMediaNode(item, mediaId, shortcode, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const nodeId = obj.pk ?? obj.id ?? obj.media_id;
    const nodeCode = obj.code ?? obj.shortcode;
    const looksLikeMedia = obj.media_type != null
      || obj.video_versions != null
      || obj.code != null
      || obj.caption != null;
    const idMatches = mediaId && nodeId != null && String(nodeId) === String(mediaId);
    const codeMatches = shortcode && nodeCode === shortcode;

    if (looksLikeMedia && (idMatches || codeMatches)) return obj;

    for (const key of Object.keys(obj)) {
      const found = findMediaNode(obj[key], mediaId, shortcode, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function viewsFromMediaNode(node) {
    let best = null;
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 8) return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      for (const key of Object.keys(value)) {
        const child = value[key];
        if (isViewCountKey(key) && child != null) {
          const parsed = parseCount(child);
          if (parsed !== null && (best === null || parsed > best)) best = parsed;
        } else if (child && typeof child === 'object') {
          visit(child, depth + 1);
        }
      }
    };
    visit(node);
    return best;
  }

  /**
   * Strategy 2a: Parse from application/ld+json
   */
  function extractFromEmbeddedJson() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          if (data && (data['@type'] === 'SocialMediaPosting' || data.author)) {
            return {
              likes: parseCount(data.interactionStatistic?.find(s => s.interactionType?.includes('Like'))?.userInteractionCount),
              comments: parseCount(data.interactionStatistic?.find(s => s.interactionType?.includes('Comment'))?.userInteractionCount),
              views: parseCount(data.interactionStatistic?.find(s => s.interactionType?.includes('WatchAction') || s.interactionType?.includes('ViewAction'))?.userInteractionCount),
              username: data.author?.alternateName?.replace('@', '') || data.author?.identifier || null,
              caption: data.articleBody || data.description || null,
              postDate: data.dateCreated || data.datePublished || data.uploadDate || null,
            };
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  /**
   * Strategy 2b: Parse play_count / video_view_count from page scripts.
   * Only counts nested inside the target media node are accepted.
   */
  function extractFromPageScripts(mediaId, shortcode) {
    const result = { views: null, isVideo: false };
    let bestViews = null;

    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text) continue;

      if (!result.isVideo && /is_video["']?\s*:\s*true|"media_type"\s*:\s*2|GraphVideo|XDTGraphVideo/.test(text)) {
        result.isVideo = true;
      }

      const looksLikeJson = text.trim().startsWith('{')
        || text.trim().startsWith('[')
        || script.type === 'application/json';
      if (!looksLikeJson || text.length > 2000000) continue;

      try {
        const data = JSON.parse(text);
        const node = findMediaNode(data, mediaId, shortcode);
        if (!node) continue;

        const views = viewsFromMediaNode(node);
        if (views !== null && (bestViews === null || views > bestViews)) {
          bestViews = views;
          result.isVideo = true;
        }
      } catch (e) {}
    }

    result.views = bestViews;
    return result;
  }

  async function fetchInstagramJson(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json,text/javascript,*/*;q=0.1',
          'X-IG-App-ID': '936619743392459',
          'X-ASBD-ID': '129477',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': getCookieValue('csrftoken'),
        },
      });

      if (!response.ok) return null;

      const text = await response.text();
      const trimmed = text.trim();
      if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;

      return JSON.parse(trimmed);
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Strategy 2c: Query Instagram's own JSON endpoints from the logged-in page.
   * This catches modern Reels where play_count is not rendered in DOM/meta.
   */
  async function extractFromInstagramApi(linkObj, shortcode, mediaId) {
    const sourceUrl = (linkObj && linkObj.url) || window.location.href;
    shortcode = shortcode || getShortcodeFromUrl(sourceUrl) || getShortcodeFromUrl(window.location.href);
    const result = { views: null };

    if (!shortcode) return result;

    mediaId = mediaId || shortcodeToMediaId(shortcode);
    const urls = [];

    if (mediaId) {
      urls.push(`https://www.instagram.com/api/v1/media/${mediaId}/info/`);
    }

    urls.push(`https://www.instagram.com/${isVideoOrReelUrl(sourceUrl) ? 'reel' : 'p'}/${shortcode}/?__a=1&__d=dis`);

    for (const url of urls) {
      const data = await fetchInstagramJson(url);
      if (!data) continue;

      const node = findMediaNode(data, mediaId, shortcode);
      if (!node) continue;

      const views = viewsFromMediaNode(node);
      if (views !== null && (result.views === null || views > result.views)) {
        result.views = views;
      }
    }

    return result;
  }

  /**
   * Strategy 3: Parse from DOM elements directly (brute force text search)
   */
  function extractFromDOM() {
    const result = {
      likes: null,
      comments: null,
      views: null,
      username: null,
      caption: null,
      postDate: null,
    };

    // --- USERNAME ---
    const headerLink = document.querySelector('header a[href^="/"]');
    if (headerLink) {
      result.username = headerLink.getAttribute('href').replace(/\//g, '');
    }
    if (!result.username) {
      const titleMatch = document.title.match(/@([a-zA-Z0-9_.-]+)/) || document.title.match(/^(.*?)\s+on Instagram/i);
      if (titleMatch) result.username = titleMatch[1];
    }

    // Leaf nodes only: reading textContent of every ancestor div is O(n^2)
    // and can pick up unrelated nested text on large pages.
    const allTextElements = Array.from(document.querySelectorAll('span, a, button, div[role="button"]'));
    
    for (const el of allTextElements) {
      if (el.childElementCount > 0) continue;
      const textContent = el.textContent.trim().replace(/\s+/g, ' ');
      if (!textContent || textContent.length > 200) continue;
      
      // Likes: "1,234 likes" or "1,234 suka"
      if (result.likes === null) {
        let match = textContent.match(/([\d,.]+[KkMmBb]?)\s*(?:likes?|suka)\b/i);
        if (match) {
            let exact = el.getAttribute('title');
            result.likes = (exact && /^[\d,.]+$/.test(exact)) ? parseCount(exact) : parseCount(match[1]);
        }
      }
      
      // Likes: "Liked by user and 1,234 others"
      if (result.likes === null) {
        let match = textContent.match(/(?:and|dan)\s+([\d,.]+[KkMmBb]?)\s+(?:others|lainnya)/i);
        if (match) {
            let exact = el.getAttribute('title');
            result.likes = (exact && /^[\d,.]+$/.test(exact)) ? parseCount(exact) + 1 : parseCount(match[1]) + 1;
        }
      }

      // Views: "123K views", "plays", or "tayangan"
      if (result.views === null) {
        let match = textContent.match(VIEW_TEXT_PATTERN);
        if (match) {
            let exact = el.getAttribute('title');
            result.views = (exact && /^[\d,.]+$/.test(exact)) ? parseCount(exact) : parseCount(match[1]);
        } else if (/^([\d,.]+[KkMmBb]?)$/.test(textContent)) {
            let aria = el.getAttribute('aria-label') || '';
            let ariaMatch = aria.match(VIEW_TEXT_PATTERN);
            if (ariaMatch) result.views = parseCount(ariaMatch[1]);
        }
      }

      // Comments: "View all 123 comments"
      if (result.comments === null) {
        let match = textContent.match(/([\d,.]+[KkMmBb]?)\s*(?:comments?|komentar)\b/i);
        if (match) {
            let exact = el.getAttribute('title');
            result.comments = (exact && /^[\d,.]+$/.test(exact)) ? parseCount(exact) : parseCount(match[1]);
        }
      }
    }

    // Reels often expose view count only via aria-label on icon wrappers
    if (result.views === null) {
      const ariaEls = document.querySelectorAll('[aria-label]');
      for (const el of ariaEls) {
        const aria = el.getAttribute('aria-label') || '';
        const ariaMatch = aria.match(VIEW_TEXT_PATTERN);
        if (ariaMatch) {
          result.views = parseCount(ariaMatch[1]);
          break;
        }
      }
    }

    // --- CAPTION ---
    const captionEl = document.querySelector('h1') || document.querySelector('div[role="button"] span');
    if (captionEl) {
      result.caption = truncateText(captionEl.textContent, 500);
    }

    // --- POST DATE ---
    const timeEl = document.querySelector('time[datetime]');
    if (timeEl) {
      result.postDate = timeEl.getAttribute('datetime');
    }

    return result;
  }

  function findUserNode(obj, username, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findUserNode(item, username, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const nodeUsername = obj.username || obj.unique_id || obj.uniqueId;
    if (nodeUsername && String(nodeUsername).toLowerCase() === username.toLowerCase()) {
      const count = obj.follower_count ?? obj.followerCount ?? obj.edge_followed_by?.count;
      if (count != null) return obj;
    }

    for (const key of Object.keys(obj)) {
      const found = findUserNode(obj[key], username, depth + 1);
      if (found) return found;
    }
    return null;
  }

  /**
   * Follower count is often embedded on the post page itself. Using it avoids
   * a second profile navigation for every Instagram task.
   */
  function extractFollowerFromPageScripts(username) {
    if (!username) return null;
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text || !text.includes('follower_count') || text.length > 1500000) continue;
      try {
        const data = JSON.parse(text);
        const node = findUserNode(data, username);
        if (!node) continue;
        const count = parseCount(
          node.follower_count ?? node.followerCount ?? node.edge_followed_by?.count
        );
        if (count !== null) return count;
      } catch (e) {}
    }
    return null;
  }

  function detectBlockState() {
    const path = (window.location.pathname || '').toLowerCase();
    if (path.includes('/accounts/login') || path.includes('/challenge')) return 'AUTH';

    const meta = document.querySelector('meta[name="description"]');
    const metaText = ((meta && meta.getAttribute('content')) || '').toLowerCase();
    if (metaText.startsWith('login') || metaText.includes('log in')) return 'AUTH';

    const bodyText = (document.body ? document.body.innerText : '').slice(0, 4000).toLowerCase();
    if (
      bodyText.includes("page isn't available")
      || bodyText.includes('halaman ini tidak tersedia')
      || bodyText.includes('page not found')
      || bodyText.includes('private account')
      || bodyText.includes('akun pribadi')
    ) return 'PERMANENT';
    if (bodyText.includes('try again later') || bodyText.includes('coba lagi nanti')) {
      return 'THROTTLED';
    }
    return null;
  }

  /**
   * Extract follower count from profile page
   */
  function extractFollowerCount() {
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      const content = metaDesc.getAttribute('content') || '';
      const followerMatch = content.match(/([\d,.]+[KkMmBb]?)\s*Followers/i) || content.match(/([\d,.]+[KkMmBb]?)\s*Pengikut/i);
      if (followerMatch) {
        return parseCount(followerMatch[1]);
      }
    }

    const allLinks = document.querySelectorAll('a[href*="followers"], span, li, a');
    for (const el of allLinks) {
      let textContent = el.textContent.trim();
      let match = textContent.match(/^([\d,.]+[KkMmBb]?)\s*(followers|pengikut)$/i);
      
      if (match) {
        let exact = el.getAttribute('title');
        if (exact && /^[\d,.]+$/.test(exact)) {
            return parseCount(exact);
        } else {
            return parseCount(match[1]);
        }
      }
    }
    return null;
  }

  /**
   * Main extraction function — called by background.js
   */
  async function scrapeInstagramPost(linkObj) {
    // Fast path: meta tags are usually ready as soon as document_idle fires.
    // Only wait for hydration when the quick read came back empty.
    const quickMeta = extractFromMetaTags();
    if (quickMeta.likes === null && quickMeta.comments === null) {
      await waitForSelector('article, main, meta[name="description"]', 7000);
      await new Promise(r => setTimeout(r, 350));
    }

    const sourceUrl = (linkObj && linkObj.url) || window.location.href;
    const shortcode = getShortcodeFromUrl(sourceUrl) || getShortcodeFromUrl(window.location.href);
    const mediaId = shortcode ? shortcodeToMediaId(shortcode) : null;

    const metaData = extractFromMetaTags();
    const jsonData = extractFromEmbeddedJson() || {};
    const scriptData = extractFromPageScripts(mediaId, shortcode);
    const domData = extractFromDOM();
    const apiData = await extractFromInstagramApi(linkObj, shortcode, mediaId);

    const isVideoContent = scriptData.isVideo
      || isVideoOrReelUrl(window.location.href)
      || (linkObj && linkObj.url && isVideoOrReelUrl(linkObj.url))
      || !!document.querySelector('video');

    // Priority: Meta Tags > ld+json > page scripts > DOM
    const result = {
      platform: 'instagram',
      url: window.location.href,
      username: metaData.username || jsonData.username || domData.username || null,
      likes: metaData.likes ?? jsonData.likes ?? domData.likes ?? null,
      comments: metaData.comments ?? jsonData.comments ?? domData.comments ?? null,
      views: apiData.views ?? metaData.views ?? jsonData.views ?? scriptData.views ?? domData.views ?? null,
      shares: null,
      caption: truncateText(jsonData.caption || domData.caption || null, 500),
      postDate: (jsonData.postDate || domData.postDate || '').substring(0, 10) || null,
      followerCount: null,
      status: 'OK',
      error: null,
      errorCode: null,
      scrapedAt: new Date().toISOString(),
    };

    // If username is completely missing, fallback to the one passed from the CSV
    if (!result.username && linkObj && linkObj.username) {
        result.username = linkObj.username;
    }

    if (result.followerCount === null) {
      result.followerCount = extractFollowerFromPageScripts(result.username);
    }

    const blockState = detectBlockState();

    // Quick sanity check: If we have absolutely no stats, it is private,
    // deleted, or gated by login. Classify it so the backend does not retry
    // something that can never succeed.
    if (result.likes === null && result.comments === null && result.views === null) {
      if (blockState === 'AUTH') {
          result.status = 'FAILED';
          result.error = 'Login required / Session expired';
          result.errorCode = 'AUTH';
      } else if (blockState === 'THROTTLED') {
          result.status = 'FAILED';
          result.error = 'Instagram meminta coba lagi nanti (throttled)';
          result.errorCode = 'THROTTLED';
      } else if (blockState === 'PERMANENT') {
          result.status = 'FAILED';
          result.error = 'Postingan tidak tersedia atau akun private';
          result.errorCode = 'PERMANENT';
      } else {
          result.status = 'PARTIAL';
          result.error = 'Could not extract all data — page might be private or login required';
          result.errorCode = 'TRANSIENT';
      }
    } else if (
      result.views === null
      && isVideoContent
      && (result.likes !== null || result.comments !== null)
    ) {
      result.status = 'PARTIAL';
      result.error = 'Views not found (video/reel; API fallback unavailable)';
    }

    return result;
  }

  /**
   * Scrape follower count from a profile page
   */
  async function scrapeInstagramProfile() {
    await waitForSelector('meta[name="description"], header', 5000);
    await new Promise(r => setTimeout(r, 250));

    const username = window.location.pathname.replace(/\//g, '');
    let followerCount = extractFollowerCount();
    if (followerCount === null) {
      followerCount = extractFollowerFromPageScripts(username);
    }
    const blockState = detectBlockState();
    return {
      followerCount,
      username,
      errorCode: followerCount === null ? blockState : null,
    };
  }

  // Listen for messages from background.js
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapePost') {
      scrapeInstagramPost(request.linkObj).then(sendResponse);
      return true; // async
    }
    if (request.action === 'scrapeProfile') {
      scrapeInstagramProfile().then(sendResponse);
      return true;
    }
  });

})();
