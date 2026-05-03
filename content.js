// content.js - 浮动面板 + 视频速度控制 + 帧截图

(function () {
  'use strict';

  // 防止重复注入
  if (window.__vsPanelLoaded) return;
  window.__vsPanelLoaded = true;

  // ==================== 全局状态 ====================

  let forcedSpeed = 1.0;
  let isForcing = false;
  let panelVisible = false;
  let panelMinimized = false;
  let currentFormat = 'png';

  // ==================== 原型链拦截 ====================

  const origPR = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  const origDPR = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'defaultPlaybackRate');

  try {
    Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
      get() {
        if (isForcing) return forcedSpeed;
        return origPR && origPR.get ? origPR.get.call(this) : 1.0;
      },
      set(val) {
        const v = isForcing ? forcedSpeed : val;
        if (origPR && origPR.set) origPR.set.call(this, v);
      },
      configurable: true
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'defaultPlaybackRate', {
      get() {
        if (isForcing) return forcedSpeed;
        return origDPR && origDPR.get ? origDPR.get.call(this) : 1.0;
      },
      set(val) {
        const v = isForcing ? forcedSpeed : val;
        if (origDPR && origDPR.set) origDPR.set.call(this, v);
      },
      configurable: true
    });
  } catch (e) {
    console.warn('[VideoSpeed] 原型拦截失败', e);
  }

  // ==================== 视频查找 ====================

  function getAllVideos() {
    const set = new Set();
    document.querySelectorAll('video').forEach(v => set.add(v));
    document.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) el.shadowRoot.querySelectorAll('video').forEach(v => set.add(v));
    });
    try {
      document.querySelectorAll('iframe').forEach(iframe => {
        try { iframe.contentDocument.querySelectorAll('video').forEach(v => set.add(v)); } catch {}
      });
    } catch {}
    return [...set];
  }

  function getActiveVideo() {
    const isDouyin = location.hostname.includes('douyin.com') || location.hostname.includes('iesdouyin.com');

    if (isDouyin) {
      // 1. 寻找明确带有 active/playing 类的容器内的 video（最准确）
      const activeSelectors = [
        '.swiper-slide-active video',
        '.xgplayer-playing video',
        '[data-e2e="feed-active-video"] video',
        '.is-active video',
        '.xgplayer-pause video' // 涵盖用户手动暂停的情况
      ];
      
      for (const sel of activeSelectors) {
        const els = document.querySelectorAll(sel);
        for (const v of els) {
          if (v && v.readyState >= 2) return v;
        }
      }
      
      // 2. 如果没找到，寻找页面上真正在播放的视频
      const videos = Array.from(document.querySelectorAll('video'));
      const playing = videos.find(v => !v.paused && v.readyState >= 2);
      if (playing) return playing;

      // 3. 寻找播放进度最大的视频（排除预加载但还没播过的第一帧视频）
      const playedVideos = videos.filter(v => v.readyState >= 2 && v.currentTime > 0);
      if (playedVideos.length > 0) {
        playedVideos.sort((a, b) => b.currentTime - a.currentTime);
        return playedVideos[0];
      }

      // 4. 兜底 douyin-enhancer 逻辑
      const dyVideo = videos.find(v => v.readyState >= 2);
      if (dyVideo) return dyVideo;
    }

    // --- 以下为 B站 / YouTube 等其他平台的通用逻辑 ---
    const videos = getAllVideos();
    if (!videos.length) return null;

    const visibleVideos = videos.filter(v => {
      const rect = v.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
      const style = window.getComputedStyle(v);
      if (style.opacity === '0' || style.visibility === 'hidden') return false;
      return true;
    });

    const targetVideos = visibleVideos.length > 0 ? visibleVideos : videos;
    const readyVideos = targetVideos.filter(v => v.readyState >= 2);
    const candidatesToUse = readyVideos.length > 0 ? readyVideos : targetVideos;

    let candidates = candidatesToUse.filter(v => !v.paused);
    if (candidates.length === 0) {
      candidates = candidatesToUse.filter(v => v.currentTime > 0);
    }
    if (candidates.length === 0) {
      candidates = candidatesToUse;
    }

    if (candidates.length === 1) return candidates[0];

    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    let bestVideo = null;
    let minDistance = Infinity;

    for (const v of candidates) {
      const rect = v.getBoundingClientRect();
      const elCx = rect.left + rect.width / 2;
      const elCy = rect.top + rect.height / 2;
      const distance = Math.pow(elCx - cx, 2) + Math.pow(elCy - cy, 2);

      if (distance < minDistance - 10) {
        minDistance = distance;
        bestVideo = v;
      } else if (Math.abs(distance - minDistance) <= 10) {
        if (bestVideo && v.currentTime > bestVideo.currentTime) {
          bestVideo = v;
        }
      }
    }

    return bestVideo || candidates[0];
  }

  // ==================== 抖音图文模式图片检测 ====================

  /**
   * 获取抖音图文模式当前显示的图片
   * 抖音图文作品使用 Swiper 轮播，当前帧为 .swiper-slide-active
   */
  function getDouyinActiveImage() {
    // 抖音图文经常改变DOM结构，最稳妥的方法是寻找屏幕正中心最大的图片
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    let bestImg = null;
    let minDistance = Infinity;

    // 查找所有图片，并在其包含图文特征的容器中匹配
    const images = Array.from(document.querySelectorAll('img'));
    
    for (const img of images) {
      const rect = img.getBoundingClientRect();
      // 过滤太小的图标或头像
      if (rect.width < 200 || rect.height < 200) continue;
      // 过滤不在视口的
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) continue;
      
      const elCx = rect.left + rect.width / 2;
      const elCy = rect.top + rect.height / 2;
      const distance = Math.pow(elCx - cx, 2) + Math.pow(elCy - cy, 2);

      if (distance < minDistance) {
        minDistance = distance;
        bestImg = img;
      }
    }

    if (bestImg) return bestImg;

    // 兜底原来的选择器逻辑
    const selectors = [
      '.swiper-slide-active img[data-e2e="slide-image"]',
      '.swiper-slide-active img[data-e2e="slide-img"]',
      '.swiper-slide-active img',
      '[data-e2e="slide-item"].swiper-slide-active img',
      '.swiper-slide-active .album-card-image',
      '.swipe-item.active img',
      '[data-e2e="feed-detail-card"] .swipe-item.active img',
    ];

    for (const sel of selectors) {
      const img = document.querySelector(sel);
      if (img && (img.src || img.dataset.src) && img.naturalWidth > 0) {
        return img;
      }
    }
    return null;
  }

  /**
   * 判断当前页面是否为抖音图文模式
   */
  function isDouyinImageMode() {
    const isDouyin = location.hostname.includes('douyin.com') || location.hostname.includes('iesdouyin.com');
    if (!isDouyin) return false;
    
    // 检查是否有典型的图文特征
    if (
      document.querySelector('.swiper-container') ||
      document.querySelector('[data-e2e="slide-list"]') ||
      document.querySelector('.swiper-slide') ||
      document.querySelector('.album-card-image')
    ) {
      return true;
    }
    
    // 如果没有视频但找到了大图，也认为是图文模式
    const activeV = getActiveVideo();
    if (!activeV) {
      return !!getDouyinActiveImage();
    }
    
    return false;
  }

  /**
   * 截取抖音图文当前图片（直接下载原图，无需 Canvas 转换）
   */
  function captureDouyinImage(img) {
    if (!img) return null;
    // 优先使用 data-src（懒加载原图），其次 src
    const url = img.dataset.src || img.src;
    if (!url) return null;
    return { url, width: img.naturalWidth, height: img.naturalHeight };
  }

  /**
   * 通过 fetch + blob 下载跨域图片（保持原始质量）
   */
  function downloadImageByUrl(url, filename) {
    // 尝试 fetch blob 方式（可保留原始文件，不受跨域限制时）
    fetch(url, { mode: 'cors', credentials: 'omit' })
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      })
      .catch(() => {
        // fetch 失败时 fallback：Canvas 绘制后导出
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0);
          const a = document.createElement('a');
          a.href = canvas.toDataURL('image/png');
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        };
        img.src = url;
      });
  }

  // ==================== 速度控制 ====================

  function applySpeed(speed) {
    forcedSpeed = speed;
    isForcing = speed !== 1.0;
    const videos = getAllVideos();
    videos.forEach(v => {
      try {
        if (origPR && origPR.set) origPR.set.call(v, speed);
        else v.playbackRate = speed;
        if (origDPR && origDPR.set) origDPR.set.call(v, speed);
        else v.defaultPlaybackRate = speed;
      } catch {}
    });
    return videos.length > 0;
  }

  // ==================== 截图 ====================

  function captureFrame(video, format) {
    if (!video) return null;
    const w = video.videoWidth || video.clientWidth;
    const h = video.videoHeight || video.clientHeight;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(video, 0, 0, w, h);
    const mime = `image/${format}`;
    const quality = format === 'png' ? undefined : 1.0;
    return { dataUrl: canvas.toDataURL(mime, quality), width: w, height: h, format };
  }

  function downloadFrame(dataUrl, format) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    let site = 'video';
    const h = location.hostname;
    if (h.includes('douyin') || h.includes('iesdouyin')) site = 'douyin';
    else if (h.includes('bilibili') || h.includes('b23.tv')) site = 'bilibili';
    else if (h.includes('youtube') || h.includes('youtu.be')) site = 'youtube';
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `screenshot_${site}_${ts}.${format}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ==================== 创建浮动面板 ====================

  function createPanel() {
    if (document.getElementById('vs-panel')) return document.getElementById('vs-panel');

    const panel = document.createElement('div');
    panel.id = 'vs-panel';
    panel.innerHTML = `
      <div class="vs-titlebar">
        <span class="vs-title">Video Speed</span>
        <div class="vs-btns">
          <button class="vs-btn-minimize" title="最小化">─</button>
          <button class="vs-btn-close" title="关闭">✕</button>
        </div>
      </div>
      <div class="vs-body">
        <div class="vs-speed">
          <span class="vs-speed-val"><span class="vs-speed-num">1.0</span><span class="vs-unit">x</span></span>
        </div>
        <div class="vs-slider-wrap">
          <input type="range" class="vs-slider" min="0.1" max="3" step="0.1" value="1">
        </div>
        <div class="vs-presets">
          <button class="vs-preset" data-speed="0.5">0.5</button>
          <button class="vs-preset active" data-speed="1">1.0</button>
          <button class="vs-preset" data-speed="1.5">1.5</button>
          <button class="vs-preset" data-speed="2">2.0</button>
          <button class="vs-preset" data-speed="2.5">2.5</button>
          <button class="vs-preset" data-speed="3">3.0</button>
        </div>
        <div class="vs-divider"></div>
        <button class="vs-capture-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          截取当前帧
        </button>
        <div class="vs-fmts">
          <button class="vs-fmt active" data-format="png">PNG</button>
          <button class="vs-fmt" data-format="jpeg">JPEG</button>
          <button class="vs-fmt" data-format="webp">WebP</button>
        </div>
        <div class="vs-status" id="vs-status">检测视频中…</div>
      </div>
      <div class="vs-resize"></div>
    `;

    // 初始位置：右上角
    panel.style.top = '80px';
    panel.style.right = '24px';
    panel.style.width = '260px';
    panel.classList.add('vs-hidden');

    document.body.appendChild(panel);
    bindPanelEvents(panel);
    return panel;
  }

  // ==================== 面板事件绑定 ====================

  function bindPanelEvents(panel) {
    const titlebar = panel.querySelector('.vs-titlebar');
    const btnMin = panel.querySelector('.vs-btn-minimize');
    const btnClose = panel.querySelector('.vs-btn-close');
    const slider = panel.querySelector('.vs-slider');
    const speedNum = panel.querySelector('.vs-speed-num');
    const presets = panel.querySelectorAll('.vs-preset');
    const captureBtn = panel.querySelector('.vs-capture-btn');
    const fmts = panel.querySelectorAll('.vs-fmt');
    const resizeHandle = panel.querySelector('.vs-resize');
    const statusEl = panel.querySelector('#vs-status');

    // ---- 拖拽移动 ----
    let dragging = false, dragX = 0, dragY = 0;

    titlebar.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return; // 不拦截按钮点击
      if (panelMinimized) {
        // 最小化状态下点击恢复
        restorePanel();
        return;
      }
      dragging = true;
      const rect = panel.getBoundingClientRect();
      dragX = e.clientX - rect.left;
      dragY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      let x = e.clientX - dragX;
      let y = e.clientY - dragY;
      // 边界限制
      x = Math.max(0, Math.min(window.innerWidth - 60, x));
      y = Math.max(0, Math.min(window.innerHeight - 60, y));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => { dragging = false; });

    // ---- 调整大小 ----
    let resizing = false, startW = 0, startH = 0, startX = 0, startY = 0;

    resizeHandle.addEventListener('mousedown', e => {
      if (panelMinimized) return;
      resizing = true;
      startW = panel.offsetWidth;
      startH = panel.offsetHeight;
      startX = e.clientX;
      startY = e.clientY;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      const w = Math.max(200, startW + (e.clientX - startX));
      const h = Math.max(180, startH + (e.clientY - startY));
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
    });

    document.addEventListener('mouseup', () => { resizing = false; });

    // ---- 最小化 ----
    btnMin.addEventListener('click', e => {
      e.stopPropagation();
      minimizePanel();
    });

    // 最小化状态下点击恢复
    panel.addEventListener('click', e => {
      if (panelMinimized) {
        restorePanel();
      }
    });

    // ---- 关闭 ----
    btnClose.addEventListener('click', e => {
      e.stopPropagation();
      hidePanel();
    });

    // ---- 速度滑块 ----
    slider.addEventListener('input', () => {
      const speed = parseFloat(slider.value);
      forcedSpeed = speed;
      speedNum.textContent = speed.toFixed(1);
      presets.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === speed));
      applySpeed(speed);
    });

    // ---- 预设按钮 ----
    presets.forEach(b => {
      b.addEventListener('click', () => {
        const speed = parseFloat(b.dataset.speed);
        forcedSpeed = speed;
        speedNum.textContent = speed.toFixed(1);
        slider.value = speed;
        presets.forEach(bb => bb.classList.toggle('active', parseFloat(bb.dataset.speed) === speed));
        const ok = applySpeed(speed);
        updateStatus(ok ? `${speed.toFixed(1)}×` : '未检测到视频', !ok);
      });
    });

    // ---- 截图 ----
    captureBtn.addEventListener('click', () => {
      // 优先检测抖音图文模式
      const douyinImg = getDouyinActiveImage();
      if (douyinImg) {
        const result = captureDouyinImage(douyinImg);
        if (result) {
          const now = new Date();
          const pad = n => String(n).padStart(2, '0');
          const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          downloadImageByUrl(result.url, `screenshot_douyin_img_${ts}.png`);
          updateStatus(`已保存图片 ${result.width}×${result.height}`);
          return;
        }
      }
      // 其次检测视频
      const video = getActiveVideo();
      if (!video) { updateStatus('未检测到视频/图片', true); return; }
      const result = captureFrame(video, currentFormat);
      if (result) {
        downloadFrame(result.dataUrl, result.format);
        updateStatus(`已保存 ${result.width}×${result.height}`);
      } else {
        updateStatus('截图失败', true);
      }
    });

    // ---- 格式选择 ----
    fmts.forEach(b => {
      b.addEventListener('click', () => {
        fmts.forEach(f => f.classList.remove('active'));
        b.classList.add('active');
        currentFormat = b.dataset.format;
      });
    });

    // ---- 阻止面板内事件冒泡到页面 ----
    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('click', e => e.stopPropagation());
    panel.addEventListener('keydown', e => e.stopPropagation());
  }

  function updateStatus(text, isErr) {
    const el = document.querySelector('#vs-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'vs-status' + (isErr ? ' err' : ' ok');
  }

  // ==================== 面板显示/隐藏/最小化 ====================

  function showPanel() {
    const panel = createPanel();
    panel.classList.remove('vs-hidden');
    panelVisible = true;
    // 初始化状态
    const videos = getAllVideos();
    const active = getActiveVideo();
    const douyinImgMode = isDouyinImageMode();
    if (douyinImgMode) {
      updateStatus('抖音图文模式 · 可截图');
    } else if (videos.length > 0) {
      let speed = 1.0;
      try { speed = origPR && origPR.get ? origPR.get.call(active) : (active ? active.playbackRate : 1.0); } catch {}
      if (isForcing) speed = forcedSpeed;
      const numEl = panel.querySelector('.vs-speed-num');
      const sliderEl = panel.querySelector('.vs-slider');
      if (numEl) numEl.textContent = speed.toFixed(1);
      if (sliderEl) sliderEl.value = speed;
      panel.querySelectorAll('.vs-preset').forEach(b => {
        b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
      });
      updateStatus(`${videos.length} 个视频 · ${speed.toFixed(1)}×`);
    } else {
      updateStatus('未检测到视频', true);
    }
  }

  function hidePanel() {
    const panel = document.getElementById('vs-panel');
    if (panel) {
      panel.classList.add('vs-hidden');
    }
    panelVisible = false;
  }

  function minimizePanel() {
    const panel = document.getElementById('vs-panel');
    if (!panel) return;
    panelMinimized = true;
    panel.classList.add('vs-minimized');
  }

  function restorePanel() {
    const panel = document.getElementById('vs-panel');
    if (!panel) return;
    panelMinimized = false;
    panel.classList.remove('vs-minimized');
  }

  function togglePanel() {
    if (panelVisible && !panelMinimized) {
      hidePanel();
    } else if (panelMinimized) {
      restorePanel();
    } else {
      showPanel();
    }
  }

  // ==================== 消息处理（来自 background.js） ====================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {
      case 'togglePanel':
        togglePanel();
        sendResponse({ visible: panelVisible });
        return true;

      case 'setSpeed': {
        const ok = applySpeed(msg.speed);
        // 同步面板 UI
        const panel = document.getElementById('vs-panel');
        if (panel && panelVisible) {
          const numEl = panel.querySelector('.vs-speed-num');
          const sliderEl = panel.querySelector('.vs-slider');
          if (numEl) numEl.textContent = msg.speed.toFixed(1);
          if (sliderEl) sliderEl.value = msg.speed;
          panel.querySelectorAll('.vs-preset').forEach(b => {
            b.classList.toggle('active', parseFloat(b.dataset.speed) === msg.speed);
          });
        }
        sendResponse({ success: ok, speed: msg.speed });
        return true;
      }

      case 'screenshot': {
        const video = getActiveVideo();
        if (video) {
          const result = captureFrame(video, msg.format || 'png');
          if (result) {
            downloadFrame(result.dataUrl, result.format);
            sendResponse({ success: true, width: result.width, height: result.height });
          } else {
            sendResponse({ success: false });
          }
        } else {
          sendResponse({ success: false });
        }
        return true;
      }

      case 'getStatus': {
        const videos = getAllVideos();
        const active = getActiveVideo();
        const douyinImgMode = isDouyinImageMode();
        let speed = 1.0;
        try { speed = origPR && origPR.get ? origPR.get.call(active) : (active ? active.playbackRate : 1.0); } catch {}
        sendResponse({
          hasVideo: videos.length > 0 || douyinImgMode,
          videoCount: videos.length,
          speed: isForcing ? forcedSpeed : speed,
          isDouyinImage: douyinImgMode
        });
        return true;
      }
    }
  });

  // ==================== MutationObserver ====================

  const observer = new MutationObserver(mutations => {
    if (!isForcing) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
          setTimeout(() => applySpeed(forcedSpeed), 300);
          return;
        }
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ==================== 兜底：定期恢复速度 ====================

  setInterval(() => {
    if (!isForcing) return;
    getAllVideos().forEach(v => {
      try {
        const actual = origPR && origPR.get ? origPR.get.call(v) : v.playbackRate;
        if (actual !== forcedSpeed) {
          if (origPR && origPR.set) origPR.set.call(v, forcedSpeed);
          else v.playbackRate = forcedSpeed;
        }
      } catch {}
    });
  }, 500);

  // ==================== 全局快捷键：Shift+S 截图 ====================

  document.addEventListener('keydown', (e) => {
    if (e.key === 'S' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // 排除输入框，避免影响正常打字
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      // 优先检测抖音图文模式
      const douyinImg = getDouyinActiveImage();
      if (douyinImg) {
        const result = captureDouyinImage(douyinImg);
        if (result) {
          const now = new Date();
          const pad = n => String(n).padStart(2, '0');
          const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          downloadImageByUrl(result.url, `screenshot_douyin_img_${ts}.png`);
        }
        return;
      }
      // 其次检测视频
      const video = getActiveVideo();
      if (video) {
        const result = captureFrame(video, currentFormat);
        if (result) downloadFrame(result.dataUrl, result.format);
      }
    }
  }, true); // capture 阶段，优先于页面其他监听

  // ==================== 平台适配 ====================

  const host = location.hostname;

  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    setInterval(() => {
      if (!isForcing) return;
      const player = document.querySelector('#movie_player');
      if (player && typeof player.setPlaybackRate === 'function') {
        try { player.setPlaybackRate(forcedSpeed); } catch {}
      }
    }, 1000);
  }

  if (host.includes('bilibili.com')) {
    setInterval(() => {
      if (!isForcing) return;
      document.querySelectorAll('bwp-video').forEach(el => {
        const v = el.querySelector('video') || (el.shadowRoot && el.shadowRoot.querySelector('video'));
        if (v && origPR && origPR.set) {
          try { origPR.set.call(v, forcedSpeed); } catch {}
        }
      });
    }, 1000);
  }

  console.log('[VideoSpeed] Content script loaded');
})();
