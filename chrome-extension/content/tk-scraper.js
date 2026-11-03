/**
 * sunscraping — TikTok Content Script (v2 - Complete Rewrite)
 * 
 * ROOT CAUSE ANALYSIS:
 * TikTok's __UNIVERSAL_DATA_FOR_REHYDRATION__ returns statusCode: 10204 
 * ("item doesn't exist") for video pages when the server doesn't have
 * proper session cookies, OR when the page hasn't fully hydrated yet.
 * 
 * SOLUTION: Multi-layered extraction with proper timing:
 * 1. Check Rehydration JSON (only if statusCode === 0)
 * 2. Wait for TikTok's own JS to render the DOM, then read from DOM
 * 3. Use smart DOM selectors that target the ACTUAL rendered elements
 */

(function() {
  'use strict';

  // parseCount, truncateText and errorResult live in content/common.js, shared
  // with the Instagram scraper.
  const truncateText = SA_CONTENT.truncateText;
  const parseCount = SA_CONTENT.parseCount;
  const errorResult = SA_CONTENT.errorResult;

  function detectBlockState() {
    const path = (window.location.pathname || '').toLowerCase();
    if (path.includes('/login') || path.includes('/verify')) return 'AUTH';

    const body = (document.body ? document.body.innerText : '').slice(0, 4000).toLowerCase();
    if (body.includes('captcha') || body.includes('too many requests') || body.includes('try again later')) {
      return 'THROTTLED';
    }
    if (
      body.includes('video currently unavailable')
      || body.includes("couldn't find this video")
      || body.includes('video tidak tersedia')
      || body.includes('tidak dapat menemukan video')
      || body.includes('this account is private')
      || body.includes('akun ini privat')
    ) return 'PERMANENT';
    return null;
  }

  // ============================================================
  // STRATEGY 1: Extract from __UNIVERSAL_DATA_FOR_REHYDRATION__
  // Only works when TikTok SSR returns statusCode: 0
  // ============================================================
  function extractFromRehydration() {
    try {
      const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!script) return null;

      const data = JSON.parse(script.textContent);
      const ds = data['__DEFAULT_SCOPE__'] || {};

      // === VIDEO PAGE ===
      const videoDetail = ds['webapp.video-detail'];
      if (videoDetail) {
        // CRITICAL: Check statusCode first! If 10204, data is empty
        if (videoDetail.statusCode !== 0) {
          console.log('[SA] Rehydration video-detail statusCode:', videoDetail.statusCode, '- skipping');
          return null;
        }

        const itemStruct = videoDetail.itemInfo?.itemStruct;
        const pathVideoId = (window.location.pathname.match(/\/video\/(\d+)/) || [])[1];
        if (itemStruct && itemStruct.id && (!pathVideoId || String(itemStruct.id) === pathVideoId)) {
          const stats = itemStruct.stats || itemStruct.statsV2 || {};
          const author = itemStruct.author || {};
          return {
            kind: 'post',
            platform: 'tiktok',
            url: window.location.href,
            username: author.uniqueId || null,
            likes: parseCount(stats.diggCount ?? stats.heartCount ?? null),
            comments: parseCount(stats.commentCount ?? null),
            views: parseCount(stats.playCount ?? null),
            shares: parseCount(stats.shareCount ?? null),
            caption: truncateText(itemStruct.desc || '', 500) || null,
            // Full ISO instant: upload time (not just the date) is evidence.
            postDate: itemStruct.createTime ? new Date(itemStruct.createTime * 1000).toISOString() : null,
            followerCount: null,
            status: 'OK',
            errorCode: null,
            source: 'rehydration',
            scrapedAt: new Date().toISOString(),
          };
        }
      }

      // === PROFILE PAGE ===
      const userDetail = ds['webapp.user-detail'];
      if (userDetail && userDetail.statusCode === 0) {
        const userInfo = userDetail.userInfo || {};
        const user = userInfo.user || {};
        const stats = userInfo.stats || {};
        if (user.uniqueId) {
          return {
            kind: 'profile',
            platform: 'tiktok',
            url: window.location.href,
            username: user.uniqueId,
            accountId: user.id ? String(user.id) : null,
            externalId: user.secUid ? String(user.secUid) : null,
            displayName: user.nickname || null,
            bio: truncateText(user.signature || '', 300) || null,
            region: user.region || null,
            isVerified: user.verified === undefined ? null : Boolean(user.verified),
            followerCount: parseCount(stats.followerCount ?? null),
            followingCount: parseCount(stats.followingCount ?? null),
            heartCount: parseCount(stats.heartCount ?? null),
            videoCount: parseCount(stats.videoCount ?? null),
            status: 'OK',
            errorCode: null,
            source: 'rehydration',
            scrapedAt: new Date().toISOString(),
          };
        }
      }

      return null;
    } catch (e) {
      console.error('[SA] Rehydration parse error:', e);
      return null;
    }
  }

  // ============================================================
  // STRATEGY 2: Extract from SIGI_STATE (legacy TikTok)
  // ============================================================
  function extractFromSigiState() {
    try {
      const script = document.getElementById('SIGI_STATE');
      if (!script) return null;

      const data = JSON.parse(script.textContent);
      const itemModule = data.ItemModule;
      if (!itemModule) return null;

      const pathVideoId = (window.location.pathname.match(/\/video\/(\d+)/) || [])[1];
      const videoId = (pathVideoId && itemModule[pathVideoId]) ? pathVideoId : Object.keys(itemModule)[0];
      if (!videoId) return null;

      const item = itemModule[videoId];
      const stats = item.stats || {};
      const authorId = item.author;
      const authorData = data.UserModule?.users?.[authorId] || {};
      const authorStats = data.UserModule?.stats?.[authorId] || {};

      return {
        kind: 'post',
        platform: 'tiktok',
        url: window.location.href,
        username: authorData.uniqueId || authorId || null,
        likes: parseCount(stats.diggCount ?? null),
        comments: parseCount(stats.commentCount ?? null),
        views: parseCount(stats.playCount ?? null),
        shares: parseCount(stats.shareCount ?? null),
        caption: truncateText(item.desc || '', 500) || null,
        postDate: item.createTime ? new Date(item.createTime * 1000).toISOString() : null,
        followerCount: parseCount(authorStats.followerCount ?? null),
        status: 'OK',
        errorCode: null,
        source: 'sigi_state',
        scrapedAt: new Date().toISOString(),
      };
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // STRATEGY 3: Smart DOM Extraction
  // This is the PRIMARY strategy for video pages because TikTok
  // often returns statusCode 10204 in rehydration but renders
  // the data via client-side JavaScript.
  // ============================================================

  // metricFromLabel (label -> likes/comments/shares) lives in content/common.js.
  const metricFromLabel = SA_CONTENT.metricFromLabel;

  function labelOf(node) {
    if (!node) return null;
    return (
      metricFromLabel(node.getAttribute('data-e2e'))
      || metricFromLabel(node.getAttribute('aria-label'))
      || metricFromLabel(node.getAttribute('title'))
      || metricFromLabel(node.getAttribute('class'))
    );
  }

  /**
   * Walk outward from a counter element and return the metric it displays.
   * Nearest label wins: TikTok wraps the whole action bar in containers whose
   * class names mention every metric, so a deep search would mislabel.
   */
  function metricForCountElement(el) {
    const direct = labelOf(el);
    if (direct) return direct;

    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1) {
      const own = labelOf(node);
      if (own) return own;

      // Inside one action button the <strong> is unlabelled but its icon is not.
      const metrics = new Set();
      for (const icon of node.querySelectorAll('[data-e2e]')) {
        const metric = metricFromLabel(icon.getAttribute('data-e2e'));
        if (metric) metrics.add(metric);
      }
      if (metrics.size === 1) return metrics.values().next().value;

      node = node.parentElement;
    }
    return null;
  }

  function countFromElement(el) {
    const count = parseCount(el.getAttribute('title'));
    return count === null ? parseCount(el.textContent) : count;
  }

  function extractFromDOM() {
    const result = {
      platform: 'tiktok',
      url: window.location.href,
      username: null,
      likes: null,
      comments: null,
      views: null,
      shares: null,
      caption: null,
      postDate: null,
      followerCount: null,
      status: 'OK',
      errorCode: null,
      source: 'dom',
      scrapedAt: new Date().toISOString(),
    };

    // --- USERNAME from URL ---
    const urlMatch = window.location.pathname.match(/\/@([^/]+)/);
    if (urlMatch) result.username = urlMatch[1];

    // --- LIKES, COMMENTS, SHARES from data-e2e attributes ---
    const e2eMap = {
      'like-count': 'likes',
      'browse-like-count': 'likes',
      'comment-count': 'comments',
      'browse-comment-count': 'comments',
      'share-count': 'shares',
      'browse-share-count': 'shares',
    };

    for (const [attr, field] of Object.entries(e2eMap)) {
      if (result[field] !== null) continue;
      const el = document.querySelector(`[data-e2e="${attr}"]`);
      if (el) {
        const count = countFromElement(el);
        if (count !== null) result[field] = count;
      }
    }

    // --- FALLBACK: labelled action-bar counters ---
    // Deliberately not positional. The action bar's button order and count
    // change (bookmarks, duets, disabled comments), and reading
    // [0]=likes / [1]=comments / [3]=shares silently swapped metrics while
    // still reporting status OK. A counter here is accepted only if a label
    // identifies it; anything unlabelled stays null so the gap is visible.
    const countCandidates = document.querySelectorAll(
      'button strong, button [data-e2e$="-count"], [class*="DivAction"] strong, '
      + '[class*="action-bar"] strong, [class*="ButtonAction"] strong, [data-e2e$="-count"]'
    );
    for (const el of countCandidates) {
      const metric = metricForCountElement(el);
      if (!metric || result[metric] !== null) continue;
      const count = countFromElement(el);
      if (count !== null) result[metric] = count;
    }

    // --- VIEWS ---
    // Views are typically shown in a separate area, not in the action bar
    const viewSelectors = [
      '[data-e2e="video-views"]',
      '[data-e2e="browse-video-views"]',
      '[class*="video-count"]',
      '[class*="play-count"]',
    ];
    
    for (const sel of viewSelectors) {
      if (result.views !== null) break;
      const el = document.querySelector(sel);
      if (el) {
        const count = countFromElement(el);
        if (count !== null) result.views = count;
      }
    }

    // --- CAPTION ---
    const captionSelectors = [
      '[data-e2e="browse-video-desc"]',
      '[data-e2e="video-desc"]',
      '[class*="VideoMetaTitle"]',
      'h1[class*="title"]',
    ];
    for (const sel of captionSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        result.caption = truncateText(el.textContent.trim(), 500);
        break;
      }
    }

    // --- FOLLOWER COUNT (profile pages) ---
    // The header renders Following / Followers / Likes as sibling nodes, so
    // picking one by position can report the wrong number. Match the label.
    let followerEl = document.querySelector('[data-e2e="followers-count"]');
    if (!followerEl) {
      followerEl = Array.from(
        document.querySelectorAll('[class*="CountInfo"], [class*="user-count"], [class*="real-followers"]')
      ).find((el) => /follower|pengikut/i.test(el.textContent || '')
        && !/following|mengikuti|like|suka/i.test(el.textContent || ''));
    }
    if (followerEl) {
      const count = countFromElement(followerEl.querySelector('strong') || followerEl);
      if (count !== null) result.followerCount = count;
    }

    return result;
  }

  // ============================================================
  // HELPER: Wait for DOM to contain video action buttons
  // This is critical because TikTok renders via React AFTER the
  // initial HTML load. We need to wait for the actual data.
  // ============================================================
  function waitForVideoData(timeoutMs = 8000) {
    return new Promise(resolve => {
      // Check immediately
      const check = () => {
        // Look for ANY strong element inside a button (action bar)
        const buttons = document.querySelectorAll('button strong');
        if (buttons.length >= 2) return true;
        
        // Or data-e2e elements
        const e2e = document.querySelector('[data-e2e="like-count"], [data-e2e="browse-like-count"]');
        if (e2e) return true;
        
        return false;
      };

      if (check()) {
        resolve(true);
        return;
      }

      // Set up MutationObserver
      const observer = new MutationObserver(() => {
        if (check()) {
          observer.disconnect();
          resolve(true);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Timeout fallback
      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeoutMs);
    });
  }

  // ============================================================
  // HELPER: Wait for follower count on profile pages
  // ============================================================
  function waitForProfileData(timeoutMs = 6000) {
    return new Promise(resolve => {
      const check = () => {
        const el = document.querySelector('[data-e2e="followers-count"]');
        if (el) return true;
        // Also check for any strong with a large number in profile header
        const header = document.querySelector('[class*="ShareInfo"], [class*="CountInfo"]');
        if (header) return true;
        return false;
      };

      if (check()) {
        resolve(true);
        return;
      }

      const observer = new MutationObserver(() => {
        if (check()) {
          observer.disconnect();
          resolve(true);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(false); }, timeoutMs);
    });
  }

  /**
   * A post result must carry at least one number.
   *
   * On a profile page the rehydration blob has no `likes` key, so the old
   * `result.likes !== null` test passed through `undefined` and a profile visit
   * was reported as a finished post with every metric empty.
   */
  function hasAnyPostMetric(result) {
    if (!result) return false;
    return ['likes', 'comments', 'views', 'shares'].some(
      (field) => typeof result[field] === 'number' && Number.isFinite(result[field])
    );
  }

  // ============================================================
  // MAIN: Scrape TikTok Post (Video Page)
  // ============================================================
  async function scrapeTikTokPost(linkObj) {
    console.log('[SA] Starting TikTok post scrape...');

    // Step 1: Try rehydration immediately (fast path)
    let result = extractFromRehydration();
    if (result && result.kind === 'post' && hasAnyPostMetric(result)) {
      console.log('[SA] Got data from Rehydration!', result);
      return result;
    }

    // Step 2: Try SIGI_STATE
    result = extractFromSigiState();
    if (result && result.kind === 'post' && hasAnyPostMetric(result)) {
      console.log('[SA] Got data from SIGI_STATE!', result);
      return result;
    }

    // Step 3: Wait for TikTok's JS to render the DOM
    console.log('[SA] Rehydration unavailable (likely 10204). Waiting for DOM render...');
    const domReady = await waitForVideoData(8000);
    console.log('[SA] DOM ready:', domReady);

    // Step 4: Give a small extra buffer for numbers to populate
    await new Promise(r => setTimeout(r, 500));

    // Step 5: Extract from DOM
    result = extractFromDOM();

    // Step 6: If DOM also failed, try rehydration one more time
    // (TikTok might have updated the script tag after hydration)
    if (result && !hasAnyPostMetric(result)) {
      const rehydrationRetry = extractFromRehydration();
      if (rehydrationRetry && rehydrationRetry.kind === 'post'
        && hasAnyPostMetric(rehydrationRetry)) {
        console.log('[SA] Rehydration succeeded on retry!');
        result = rehydrationRetry;
      }
    }

    // Step 7: Supplement with rehydration-retry data if partial
    //   (DOM data already in `result` from Step 5, no need to re-extract)
    if (result && result.source !== 'dom' && result.status === 'OK') {
      // If result came from rehydration retry (Step 6), supplement with DOM data we already have
      const domData = extractFromDOM();
      if (!result.username) result.username = domData.username;
      if (result.likes === null) result.likes = domData.likes;
      if (result.comments === null) result.comments = domData.comments;
      if (result.views === null) result.views = domData.views;
      if (result.shares === null) result.shares = domData.shares;
      if (!result.caption) result.caption = domData.caption;
      if (result.followerCount === null) result.followerCount = domData.followerCount;
    }

    if (!result || (result.likes === null && result.comments === null && result.views === null)) {
      const blockState = detectBlockState();
      result = result || {};
      result.status = 'FAILED';
      result.errorCode = blockState || 'TRANSIENT';
      result.error = blockState === 'AUTH'
        ? 'Login required / Session expired'
        : blockState === 'THROTTLED'
          ? 'TikTok membatasi akses (throttled)'
          : blockState === 'PERMANENT'
            ? 'Video tidak tersedia atau akun private'
            : 'Could not extract data — page may require login or video is unavailable';
      result.platform = 'tiktok';
      result.url = window.location.href;
      result.scrapedAt = new Date().toISOString();
    }

    // Fallback username
    if (!result.username && linkObj && linkObj.username) {
      result.username = linkObj.username;
    }

    console.log('[SA] Final result:', result);
    return result;
  }

  // ============================================================
  // PROFILE: recent posts, collected during the same visit
  // ============================================================
  function readFollowerCountFromDom() {
    const el = document.querySelector('[data-e2e="followers-count"]');
    if (el) {
      const fromTitle = parseCount(el.getAttribute('title'));
      if (fromTitle !== null) return fromTitle;
      const fromText = parseCount(el.textContent);
      if (fromText !== null) return fromText;
    }
    const strong = document.querySelector('[class*="follower"] strong, [class*="Follower"] strong');
    if (strong) {
      const fromTitle = parseCount(strong.getAttribute('title'));
      if (fromTitle !== null) return fromTitle;
      return parseCount(strong.textContent);
    }
    return null;
  }

  /**
   * secUid is what the item-list API needs. It is inside the rehydration blob on
   * a normal page and anywhere in the page scripts when that blob is missing.
   */
  function findSecUid() {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes('secUid')) continue;
      const match = text.match(/"secUid"\s*:\s*"([^"]{10,})"/);
      if (match) return match[1];
    }
    return null;
  }

  async function fetchItemListPosts(secUid, uniqueId) {
    if (!secUid) return null;
    const query = new URLSearchParams({
      aid: '1988',
      app_name: 'tiktok_web',
      device_platform: 'webapp',
      browser_language: (navigator.language || 'id-ID'),
      count: String(SA_CONTENT.RECENT_POST_LIMIT),
      cursor: '0',
      coverType: 'jpg',
      itemType: '0',
      secUid: secUid,
    });

    // Without a ceiling this fetch could hold the worker for the full scrape
    // timeout; a profile visit that cannot list posts falls back to the grid.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://www.tiktok.com/api/post/item_list/?${query}`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json,text/plain,*/*' },
        signal: controller.signal,
      });
      if (!response.ok) return null;

      const data = JSON.parse(await response.text());
      const items = Array.isArray(data.itemList) ? data.itemList
        : (Array.isArray(data.data && data.data.itemList) ? data.data.itemList : null);
      if (!items) return null;

      return SA_CONTENT.recentPosts(items.map((item) => {
        const stats = item.stats || item.statsV2 || {};
        return {
          id: item.id,
          url: uniqueId ? `https://www.tiktok.com/@${uniqueId}/video/${item.id}` : null,
          postedAt: item.createTime,
          likes: stats.diggCount ?? stats.heartCount ?? null,
          comments: stats.commentCount ?? null,
          shares: stats.shareCount ?? null,
          views: stats.playCount ?? null,
          caption: item.desc,
          isVideo: item.imagePost ? false : true,
        };
      }));
    } catch (error) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Last resort: the links in the profile grid. Only ids and URLs are claimed
   * here — card text mixes captions with counters, and a guessed number in an
   * evidence table is worse than an empty one.
   */
  function gridPosts() {
    const links = document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]');
    const seen = new Set();
    const posts = [];
    for (const link of links) {
      const href = link.href || '';
      const match = href.match(/\/(?:video|photo)\/(\d+)/);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      posts.push({ id: match[1], url: href.split('?')[0] });
      if (posts.length >= SA_CONTENT.RECENT_POST_LIMIT) break;
    }
    return SA_CONTENT.recentPosts(posts);
  }

  // ============================================================
  // MAIN: Scrape TikTok Profile Page
  // ============================================================
  async function scrapeTikTokProfile(requestedUsername) {
    console.log('[SA] Starting TikTok profile scrape...');

    const urlMatch = window.location.pathname.match(/\/@([^/]+)/);
    const pathUsername = urlMatch ? urlMatch[1] : (requestedUsername || null);

    // Rehydration carries the identity fields; a DOM-only page only has counts.
    let profile = extractFromRehydration();
    if (!profile || profile.kind !== 'profile' || profile.followerCount === null) {
      await waitForProfileData(6000);
      await new Promise(r => setTimeout(r, 300));
      const identity = profile && profile.username ? profile : {};
      profile = {
        username: identity.username || pathUsername,
        followerCount: readFollowerCountFromDom(),
        followingCount: identity.followingCount ?? null,
        videoCount: identity.videoCount ?? null,
        accountId: identity.accountId || null,
        externalId: identity.externalId || null,
        displayName: identity.displayName || null,
        bio: identity.bio || null,
        region: identity.region || null,
        isVerified: identity.isVerified !== undefined ? identity.isVerified : null,
      };
    }

    const username = profile.username || pathUsername || null;
    const secUid = profile.externalId || findSecUid() || null;

    let posts = await fetchItemListPosts(secUid, username);
    let postSource = 'item-list';
    if (!posts || posts.length === 0) {
      posts = gridPosts();
      postSource = posts.length ? 'grid' : null;
    }

    const followerCount = profile.followerCount === undefined ? null : profile.followerCount;
    console.log('[SA] Profile scrape:', followerCount, 'followers,', posts.length, 'posts via', postSource);

    return {
      platform: 'tiktok',
      url: window.location.href,
      username: username,
      accountId: profile.accountId || null,
      externalId: secUid,
      displayName: profile.displayName || null,
      bio: profile.bio || null,
      region: profile.region || null,
      isVerified: profile.isVerified,
      followerCount: followerCount,
      followingCount: profile.followingCount ?? null,
      postCount: profile.videoCount ?? null,
      posts: posts,
      postSource: postSource,
      status: followerCount !== null || posts.length > 0 ? 'OK' : 'FAILED',
      errorCode: followerCount === null && posts.length === 0 ? detectBlockState() : null,
      scrapedAt: new Date().toISOString(),
    };
  }

  // ============================================================
  // MESSAGE LISTENER
  // ============================================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapePost') {
      scrapeTikTokPost(request.linkObj)
        .catch((error) => errorResult('tiktok', window.location.href, error))
        .then(sendResponse);
      return true;
    }
    if (request.action === 'scrapeProfile') {
      scrapeTikTokProfile(request.username)
        .catch((error) => errorResult('tiktok', window.location.href, error))
        .then(sendResponse);
      return true;
    }
  });
})();
