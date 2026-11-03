/**
 * sunscraping — Instagram Content Script
 * Membaca data postingan dari halaman Instagram yang sudah dirender browser.
 * Didukung sebagai content script di manifest; background mengirim pesan
 * scrapePost/scrapeProfile dan menunggu balasan dari script ini.
 */

(function() {
  'use strict';

  // parseCount, truncateText and errorResult live in content/common.js, shared
  // with the TikTok scraper.
  const parseCount = SA_CONTENT.parseCount;
  const truncateText = SA_CONTENT.truncateText;
  const errorResult = SA_CONTENT.errorResult;

  // A rendered counter token kept whole (suffix included) for the shared
  // parseCount, so Indonesian "7,4rb"/"1,2 jt" and English "7.4K" resolve to the
  // same number instead of the follower count landing as null on a localized
  // profile page.
  const COUNT_TOKEN = /[\d.,]+\s*(?:billion|million|thousand|miliar|milyar|juta|ribu|mn|jt|rb|[kKmMbB])?/;

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
  // Cheap relevance test for multi-megabyte page scripts: only blobs that
  // mention a counter are ever handed to JSON.parse.
  const PLAY_COUNT_HINT = /play_count|playCount|view_count|viewCount/i;
  const FOLLOWER_COUNT_HINT = /follower_count|followerCount|edge_followed_by/i;

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

  function firstValue(...values) {
    for (const value of values) {
      if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
  }

  /**
   * Everything one media node knows, not just the view count. Reels pages ship
   * the author, upload time and caption only inside this payload, so reading
   * play_count and dropping the rest is what left 111 Instagram rows with no
   * handle, no date and no caption.
   */
  function fieldsFromMediaNode(node) {
    const user = node.user || node.owner || null;
    const caption = node.caption && typeof node.caption === 'object'
      ? node.caption.text
      : node.edge_media_to_caption?.edges?.[0]?.node?.text ?? node.caption;
    return {
      username: (user && (user.username || user.unique_id || user.uniqueId)) || null,
      postDate: SA_CONTENT.toIsoTime(
        node.taken_at ?? node.taken_at_timestamp ?? node.timestamp ?? node.date ?? null
      ),
      caption: caption ? truncateText(caption, 500) : null,
      likes: parseCount(node.like_count ?? node.edge_liked_by?.count ?? node.edge_media_preview_like?.count),
      comments: parseCount(node.comment_count ?? node.edge_media_to_comment?.count),
      views: viewsFromMediaNode(node),
      followerCount: parseCount(user && (user.follower_count ?? user.edge_followed_by?.count)),
    };
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
    const result = {
      views: null,
      isVideo: false,
      username: null,
      postDate: null,
      caption: null,
      likes: null,
      comments: null,
      followerCount: null,
    };
    let bestViews = null;

    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text) continue;

      if (!result.isVideo && /is_video["']?\s*:\s*true|"media_type"\s*:\s*2|GraphVideo|XDTGraphVideo/.test(text)) {
        result.isVideo = true;
      }

      const looksLikeJson = script.type === 'application/json' || /^\s*[[{]/.test(text);
      // Instagram's data-sjs payloads run to several megabytes and are exactly
      // where play_count lives, so size alone must not skip them. Relevance
      // decides: a blob that never mentions a counter is not parsed at all.
      if (!looksLikeJson || !PLAY_COUNT_HINT.test(text)) continue;

      try {
        const data = JSON.parse(text);
        const node = findMediaNode(data, mediaId, shortcode);
        if (!node) continue;

        const fields = fieldsFromMediaNode(node);
        if (fields.views !== null && (bestViews === null || fields.views > bestViews)) {
          bestViews = fields.views;
          result.isVideo = true;
        }
        result.username = result.username || fields.username;
        result.postDate = result.postDate || fields.postDate;
        result.caption = result.caption || fields.caption;
        result.likes = result.likes ?? fields.likes;
        result.comments = result.comments ?? fields.comments;
        result.followerCount = result.followerCount ?? fields.followerCount;
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
          // Public web-client id; /api/v1/ rejects requests without it.
          'X-IG-App-ID': '936619743392459',
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
   * Strategy 2c: Instagram's own media endpoint, from the logged-in page.
   * Last resort for Reels whose play count never reaches meta tags or the DOM.
   * The old "?__a=1&__d=dis" page fetch was dropped: Instagram stopped serving
   * JSON there, so it only added latency to every single post.
   */
  async function extractFromInstagramApi(linkObj, shortcode, mediaId) {
    shortcode = shortcode
      || getShortcodeFromUrl((linkObj && linkObj.url) || window.location.href)
      || getShortcodeFromUrl(window.location.href);
    mediaId = mediaId || (shortcode ? shortcodeToMediaId(shortcode) : null);
    if (!mediaId) return { views: null };

    const data = await fetchInstagramJson(`https://www.instagram.com/api/v1/media/${mediaId}/info/`);
    const node = data ? findMediaNode(data, mediaId, shortcode) : null;
    if (!node) return { views: null };
    return fieldsFromMediaNode(node);
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
    // Only the profile link, the "(@handle)" title form, or the og:title copy
    // count. The old fallback took the display name out of "Name on Instagram",
    // which turned "Salsabilla F" into a handle that matches no account.
    const RESERVED_PATHS = /^(explore|reels?|p|tv|accounts|direct|about|developer|legal|directory|challenge|stories)$/i;
    const handleFromPath = (href) => {
      const match = String(href || '').match(/^\/([A-Za-z0-9_.]+)\/?$/);
      return match && !RESERVED_PATHS.test(match[1]) ? match[1] : null;
    };
    result.username = handleFromPath(document.querySelector('header a[href^="/"]')?.getAttribute('href'));
    if (!result.username) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const titleText = [document.title, ogTitle ? ogTitle.getAttribute('content') : ''].join(' ');
      const handleMatch = titleText.match(/\(@([a-zA-Z0-9_.-]+)\)/) || titleText.match(/@([a-zA-Z0-9_.]+)\s+on Instagram/i);
      if (handleMatch) result.username = handleMatch[1];
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
    if (!result.caption) {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      const ogText = ogDesc ? (ogDesc.getAttribute('content') || '').trim() : '';
      // "1,234 Likes, 56 Comments - Name (@handle) on Instagram: \"caption\""
      const quoted = ogText.match(/Instagram:\s*["“]([\s\S]+)["”]\s*$/);
      if (quoted) result.caption = truncateText(quoted[1], 500);
    }

    // --- POST DATE ---
    const timeEl = document.querySelector('time[datetime]')
      || document.querySelector('a[href*="/p/"] time[datetime]')
      || document.querySelector('a[href*="/reel/"] time[datetime]');
    if (timeEl) {
      result.postDate = SA_CONTENT.toIsoTime(timeEl.getAttribute('datetime'));
    }
    if (!result.postDate) {
      const published = document.querySelector('meta[property="article:published_time"]');
      if (published) result.postDate = SA_CONTENT.toIsoTime(published.getAttribute('content'));
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
      if (!text || !FOLLOWER_COUNT_HINT.test(text)) continue;
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
      const followerMatch = content.match(new RegExp('(' + COUNT_TOKEN.source + ')\\s*Followers', 'i'))
        || content.match(new RegExp('(' + COUNT_TOKEN.source + ')\\s*Pengikut', 'i'));
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

    let username = firstValue(metaData.username, jsonData.username, scriptData.username, domData.username);
    let likes = firstValue(metaData.likes, jsonData.likes, scriptData.likes, domData.likes);
    let comments = firstValue(metaData.comments, jsonData.comments, scriptData.comments, domData.comments);
    let views = firstValue(metaData.views, jsonData.views, scriptData.views, domData.views);
    let caption = firstValue(jsonData.caption, scriptData.caption, domData.caption);
    let postDate = firstValue(jsonData.postDate, scriptData.postDate, domData.postDate);
    let followerCount = scriptData.followerCount ?? null;

    // One request, and only when the page left a hole. The old rule was "views
    // missing" alone, so a reels page that showed views was never asked for the
    // author, date or caption it had not rendered.
    if (username === null || postDate === null || caption === null || views === null) {
      const apiData = await extractFromInstagramApi(linkObj, shortcode, mediaId) || {};
      username = username ?? apiData.username ?? null;
      likes = likes ?? apiData.likes ?? null;
      comments = comments ?? apiData.comments ?? null;
      views = views ?? apiData.views ?? null;
      caption = caption ?? apiData.caption ?? null;
      postDate = postDate ?? apiData.postDate ?? null;
      followerCount = followerCount ?? apiData.followerCount ?? null;
    }

    const isVideoContent = scriptData.isVideo
      || isVideoOrReelUrl(window.location.href)
      || (linkObj && linkObj.url && isVideoOrReelUrl(linkObj.url))
      || !!document.querySelector('video');

    // Priority: Meta Tags > ld+json > page scripts > DOM
    const result = {
      platform: 'instagram',
      url: window.location.href,
      username,
      likes,
      comments,
      views,
      shares: null,
      caption: truncateText(caption, 500),
      postDate,
      followerCount,
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
      && result.likes !== null
      && result.comments !== null
    ) {
      // Instagram engagement rate is (likes + comments) / followers, so views
      // is never part of the IG formula. Carousel/reel slides (e.g.
      // /p/CODE/?img_index=N) routinely hide the play count, so a video with
      // full engagement but no exposed view count is a complete row, not a
      // partial one.
      result.error = null;
      result.viewsMissingReason = 'video/reel without an exposed view count';
    } else if (
      result.views === null
      && isVideoContent
      && (result.likes !== null || result.comments !== null)
    ) {
      result.status = 'PARTIAL';
      result.error = 'Views not found (video/reel; neither the page nor the API returned a count)';
    }

    return result;
  }

  /**
   * "7.4k Followers, 12 Following, 214 Posts - ..." is served in the meta tag of
   * every public profile, so the three account totals cost no extra request.
   */
  function countsFromMetaDescription() {
    const meta = document.querySelector('meta[name="description"]');
    const content = meta ? (meta.getAttribute('content') || '') : '';
    const grab = (label) => {
      const match = content.match(new RegExp('(' + COUNT_TOKEN.source + ')\\s*(?:' + label + ')', 'i'));
      return match ? parseCount(match[1]) : null;
    };
    return {
      followerCount: grab('Followers|Pengikut'),
      followingCount: grab('Following|Mengikuti'),
      postCount: grab('Posts|Postingan'),
    };
  }

  /**
   * The display name is served in the meta description / og:title of every
   * public profile, so a profile visit that never reached the web_profile_info
   * JSON still fills the identity field instead of leaving it blank forever.
   *   "... Posts - Display Name (@handle) on Instagram" -> Display Name
   *   "Display Name (@handle) • Instagram photos and videos" -> Display Name
   */
  function displayNameFromMeta() {
    const metaDesc = document.querySelector('meta[name="description"]');
    const content = metaDesc ? (metaDesc.getAttribute('content') || '') : '';

    let match = content.match(/[-–—]\s+(.+?)\s+on Instagram$/i);
    if (match) {
      const name = match[1].trim();
      if (name && !/^See .+ and videos from /.test(name)) return truncateText(name, 120);
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      const title = ogTitle.getAttribute('content') || '';
      match = title.match(/^(.+?)\s+\(@[\w.]+\)/);
      if (match) return truncateText(match[1].trim(), 120);
    }
    return null;
  }

  /** Same scan the follower lookup uses, but returning the whole user node. */
  function findProfileUserNode(username) {
    if (!username) return null;
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text || !FOLLOWER_COUNT_HINT.test(text)) continue;
      try {
        const node = findUserNode(JSON.parse(text), username);
        if (node) return node;
      } catch (e) {}
    }
    return null;
  }

  /**
   * Canonical ref is the shortcode: it is also the tail of the post URL, so the
   * backend dedupes the same post whether it arrived from page JSON or the API.
   */
  function postsFromTimeline(node) {
    const timeline = node && (node.edge_owner_to_timeline_media || node.timeline);
    const rawEdges = Array.isArray(timeline && timeline.edges) ? timeline.edges
      : (Array.isArray(node && node.items) ? node.items : null);
    if (!rawEdges) return null;

    return SA_CONTENT.recentPosts(rawEdges.map((edge) => {
      const media = edge && edge.node ? edge.node : edge;
      if (!media || typeof media !== 'object') return null;
      const code = media.code || media.shortcode || null;
      const isVideo = Boolean(media.is_video) || media.media_type === 2;
      return {
        id: code,
        url: code ? `https://www.instagram.com/${isVideo ? 'reel' : 'p'}/${code}/` : null,
        postedAt: media.taken_at ?? media.taken_at_timestamp ?? media.timestamp ?? null,
        likes: media.edge_liked_by?.count ?? media.like_count ?? null,
        comments: media.edge_media_to_comment?.count ?? media.comment_count ?? null,
        views: media.video_view_count ?? media.play_count ?? null,
        shares: null,
        caption: media.edge_media_to_caption?.edges?.[0]?.node?.text
          ?? (media.caption && media.caption.text) ?? null,
        isVideo,
      };
    }));
  }

  async function fetchProfileFromWebApi(username) {
    if (!username) return null;
    const data = await fetchInstagramJson(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
    );
    return data && data.data ? data.data.user || null : null;
  }

  /**
   * Scrape a profile page: account fingerprint plus its most recent posts.
   * Everything comes out of the one visit — the post list is either embedded in
   * the page or fetched from the same origin while the page is open.
   */
  async function scrapeInstagramProfile(requestedUsername) {
    await waitForSelector('meta[name="description"], header', 5000);
    await new Promise(r => setTimeout(r, 250));

    const pathMatch = window.location.pathname.match(/^\/(@?[^/?#]+)/);
    const pathUsername = pathMatch ? pathMatch[1].replace(/^@/, '') : '';
    // The worker chose this profile, so its handle is the reliable key; the path
    // is only a fallback for a scrape that was started from the page itself.
    const username = requestedUsername || pathUsername;

    const metaCounts = countsFromMetaDescription();
    let followerCount = extractFollowerCount();
    if (followerCount === null) followerCount = extractFollowerFromPageScripts(username);
    if (followerCount === null) followerCount = metaCounts.followerCount;

    let node = findProfileUserNode(username);
    let postSource = 'page-json';
    let posts = node ? postsFromTimeline(node) : null;
    if (!posts || posts.length === 0) {
      node = await fetchProfileFromWebApi(username) || node;
      posts = node ? postsFromTimeline(node) : null;
      postSource = posts && posts.length ? 'web-profile-api' : null;
    }
    posts = posts || [];

    if (followerCount === null && node) {
      followerCount = parseCount(node.edge_followed_by?.count ?? node.follower_count ?? null);
    }

    const blockState = detectBlockState();
    return {
      platform: 'instagram',
      url: window.location.href,
      username: (node && node.username) || username || null,
      accountId: node && (node.pk ?? node.id) !== undefined ? String(node.pk ?? node.id) : null,
      externalId: null,
      displayName: (node && node.full_name) || displayNameFromMeta(),
      bio: (node && node.biography) ? truncateText(node.biography, 300) : null,
      region: null,
      isVerified: node && node.is_verified !== undefined ? Boolean(node.is_verified) : null,
      followerCount: followerCount,
      followingCount: parseCount(node?.edge_follow?.count ?? null) ?? metaCounts.followingCount,
      postCount: parseCount(node?.edge_owner_to_timeline_media?.count ?? null) ?? metaCounts.postCount,
      posts: posts,
      postSource: posts.length ? postSource : null,
      status: followerCount !== null || posts.length > 0 ? 'OK' : 'FAILED',
      errorCode: followerCount === null && posts.length === 0 ? blockState : null,
      scrapedAt: new Date().toISOString(),
    };
  }

  // Listen for messages from background.js
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapePost') {
      scrapeInstagramPost(request.linkObj)
        .catch((error) => errorResult('instagram', window.location.href, error))
        .then(sendResponse);
      return true; // async
    }
    if (request.action === 'scrapeProfile') {
      scrapeInstagramProfile(request.username)
        .catch((error) => errorResult('instagram', window.location.href, error))
        .then(sendResponse);
      return true;
    }
  });

})();
