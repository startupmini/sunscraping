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

  // ============================================================
  // UTILITY: Parse count strings like "12.5K", "1.2M", "1234", "23rb"
  // ============================================================
  function truncateText(text, maxChars) {
    if (text === null || text === undefined) return null;
    const value = String(text);
    const chars = Array.from(value);
    return chars.length > maxChars ? chars.slice(0, maxChars).join('') : value;
  }

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

  function parseCount(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;

    let text = String(value).trim().toLowerCase().replace(/\s+/g, '');
    if (!text) return null;

    // Indonesian suffixes
    text = text.replace(/ribu|rb/g, 'k').replace(/juta|jt/g, 'm').replace(/miliar/g, 'b');

    const match = text.match(/^([\d.,]+)([kmb])?/);
    if (!match) return null;

    const raw = match[1];
    const suffix = match[2] || '';
    const multipliers = { k: 1e3, m: 1e6, b: 1e9 };
    let number = null;

    if (suffix) {
      // "1.2K"/"1,2K" => decimal; "1.234.567K" => grouped
      if (/^\d{1,3}([.,]\d{3}){2,}$/.test(raw)) {
        number = parseFloat(raw.replace(/[.,]/g, ''));
      } else {
        number = parseFloat(raw.replace(/,/g, '.'));
      }
    } else if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) {
      // "1.234" / "1,234" => thousands grouping, not 1.234 followers
      number = parseFloat(raw.replace(/[.,]/g, ''));
    } else if (/^\d+$/.test(raw)) {
      number = parseInt(raw, 10);
    } else if (/^\d+[.,]\d{1,2}$/.test(raw)) {
      number = parseFloat(raw.replace(',', '.'));
    } else {
      number = parseFloat(raw.replace(/[^\d.]/g, ''));
    }

    if (!Number.isFinite(number)) return null;
    return Math.round(number * (multipliers[suffix] || 1));
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
            platform: 'tiktok',
            url: window.location.href,
            username: author.uniqueId || null,
            likes: parseCount(stats.diggCount ?? stats.heartCount ?? null),
            comments: parseCount(stats.commentCount ?? null),
            views: parseCount(stats.playCount ?? null),
            shares: parseCount(stats.shareCount ?? null),
            caption: truncateText(itemStruct.desc || '', 500) || null,
            postDate: itemStruct.createTime ? new Date(itemStruct.createTime * 1000).toISOString().substring(0, 10) : null,
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
            platform: 'tiktok',
            url: window.location.href,
            username: user.uniqueId,
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
        platform: 'tiktok',
        url: window.location.href,
        username: authorData.uniqueId || authorId || null,
        likes: parseCount(stats.diggCount ?? null),
        comments: parseCount(stats.commentCount ?? null),
        views: parseCount(stats.playCount ?? null),
        shares: parseCount(stats.shareCount ?? null),
        caption: truncateText(item.desc || '', 500) || null,
        postDate: item.createTime ? new Date(item.createTime * 1000).toISOString().substring(0, 10) : null,
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
      'undefined-count': 'likes', // TikTok sometimes does this
      'comment-count': 'comments',
      'browse-comment-count': 'comments',
      'share-count': 'shares',
      'browse-share-count': 'shares',
    };

    for (const [attr, field] of Object.entries(e2eMap)) {
      if (result[field] !== null) continue;
      const el = document.querySelector(`[data-e2e="${attr}"]`);
      if (el) {
        let count = parseCount(el.getAttribute('title'));
        if (count === null) count = parseCount(el.textContent);
        if (count !== null) result[field] = count;
      }
    }

    // --- FALLBACK: Read counts from buttons with <strong> children ---
    // TikTok video pages have action buttons (like, comment, bookmark, share)
    // Each button contains an SVG icon and a <strong> with the count
    if (result.likes === null) {
      const allStrongs = [];
      
      // Method A: Look for buttons containing strong elements
      document.querySelectorAll('button').forEach(btn => {
        const strong = btn.querySelector('strong');
        if (strong) {
          let count = parseCount(strong.getAttribute('title'));
          if (count === null) count = parseCount(strong.textContent);
          if (count !== null) allStrongs.push({ count, el: strong });
        }
      });
      
      // Method B: Look for any strong elements near action icons
      document.querySelectorAll('[class*="DivAction"] strong, [class*="action-bar"] strong, [class*="ButtonAction"] strong').forEach(el => {
        let count = parseCount(el.getAttribute('title'));
        if (count === null) count = parseCount(el.textContent);
        if (count !== null) allStrongs.push({ count, el });
      });

      // Deduplicate by count value while preserving order
      const seen = new Set();
      const uniqueCounts = [];
      for (const item of allStrongs) {
        const key = item.count + '_' + item.el.textContent;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueCounts.push(item.count);
        }
      }

      // TikTok order: likes, comments, bookmarks/favorites, shares
      if (uniqueCounts.length >= 2) {
        result.likes = uniqueCounts[0];
        result.comments = uniqueCounts[1];
        if (uniqueCounts.length >= 4) result.shares = uniqueCounts[3];
      } else if (uniqueCounts.length === 1) {
        result.likes = uniqueCounts[0];
      }
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
        let count = parseCount(el.getAttribute('title'));
        if (count === null) count = parseCount(el.textContent);
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
    const followerSelectors = [
      '[data-e2e="followers-count"]',
      '[title][class*="CountInfo"]:nth-child(2)',
    ];
    for (const sel of followerSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        let count = parseCount(el.getAttribute('title'));
        if (count === null) count = parseCount(el.textContent);
        if (count !== null) {
          result.followerCount = count;
          break;
        }
      }
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

  // ============================================================
  // MAIN: Scrape TikTok Post (Video Page)
  // ============================================================
  async function scrapeTikTokPost(linkObj) {
    console.log('[SA] Starting TikTok post scrape...');

    // Step 1: Try rehydration immediately (fast path)
    let result = extractFromRehydration();
    if (result && result.likes !== null) {
      console.log('[SA] Got data from Rehydration!', result);
      return result;
    }

    // Step 2: Try SIGI_STATE
    result = extractFromSigiState();
    if (result && result.likes !== null) {
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
    if (result && result.likes === null) {
      const rehydrationRetry = extractFromRehydration();
      if (rehydrationRetry && rehydrationRetry.likes !== null) {
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
  // MAIN: Scrape TikTok Profile Page
  // ============================================================
  async function scrapeTikTokProfile() {
    console.log('[SA] Starting TikTok profile scrape...');

    const urlMatch = window.location.pathname.match(/\/@([^/]+)/);
    const username = urlMatch ? urlMatch[1] : null;

    // Step 1: Try rehydration (works well for profile pages)
    const rehydrationData = extractFromRehydration();
    if (rehydrationData && rehydrationData.followerCount !== null) {
      console.log('[SA] Profile data from Rehydration:', rehydrationData.followerCount);
      return {
        followerCount: rehydrationData.followerCount,
        username: rehydrationData.username || username,
      };
    }

    // Step 2: Wait for DOM
    await waitForProfileData(6000);
    await new Promise(r => setTimeout(r, 300));

    // Step 3: DOM extraction
    let followerCount = null;

    // data-e2e attribute
    const el = document.querySelector('[data-e2e="followers-count"]');
    if (el) {
      followerCount = parseCount(el.getAttribute('title'));
      if (followerCount === null) followerCount = parseCount(el.textContent);
    }

    // Fallback: Any element with class containing "follower" and a strong child
    if (followerCount === null) {
      const strong = document.querySelector('[class*="follower"] strong, [class*="Follower"] strong');
      if (strong) {
        followerCount = parseCount(strong.getAttribute('title'));
        if (followerCount === null) followerCount = parseCount(strong.textContent);
      }
    }

    console.log('[SA] Profile followerCount:', followerCount);
    return {
      followerCount,
      username: username,
      errorCode: followerCount === null ? detectBlockState() : null,
    };
  }

  // ============================================================
  // MESSAGE LISTENER
  // ============================================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapePost') {
      scrapeTikTokPost(request.linkObj).then(sendResponse);
      return true;
    }
    if (request.action === 'scrapeProfile') {
      scrapeTikTokProfile().then(sendResponse);
      return true;
    }
  });
})();
