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
    const videos = getAllVideos();
    if (!videos.length) return null;

    // 优先返回正在播放且可见的视频（面积最大的）
    const playing = videos.filter(v => !v.paused && v.offsetWidth > 0 && v.offsetHeight > 0);
    if (playing.length > 0) {
      return playing.reduce((a, b) => (a.videoWidth * a.videoHeight > b.videoWidth * b.videoHeight ? a : b));
    }

    // 如果所有视频都暂停了（比如截图时用户按了暂停），则找最居中且可见的视频
    const visibleVideos = videos.filter(v => v.offsetWidth > 0 && v.offsetHeight > 0);
    if (visibleVideos.length === 0) return videos[0];

    let bestVideo = null;
    let minDistance = Infinity;
    const centerY = window.innerHeight / 2;
    const centerX = window.innerWidth / 2;

    visibleVideos.forEach(v => {
      const rect = v.getBoundingClientRect();
      // 对于 iframe 内的视频，rect 可能是相对 iframe 的，这里做个简单计算
      const vCenterY = rect.top + rect.height / 2;
      const vCenterX = rect.left + rect.width / 2;
      const dist = Math.pow(vCenterY - centerY, 2) + Math.pow(vCenterX - centerX, 2);
      if (dist < minDistance) {
        minDistance = dist;
        bestVideo = v;
      }
    });

    return bestVideo || visibleVideos.reduce((a, b) => (a.videoWidth * a.videoHeight > b.videoWidth * b.videoHeight ? a : b));
  }

  // ==================== 抖音图文模式图片检测 ====================

  /**
   * 获取抖音图文模式当前显示的图片
   * 抖音图文作品使用 Swiper 轮播，当前帧为 .swiper-slide-active
   */
  function getDouyinActiveImage() {
    if (!location.hostname.includes('douyin.com')) return null;
    
    // 寻找屏幕中最居中且比较大的图片
    const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
      const rect = img.getBoundingClientRect();
      // 过滤掉小图标、头像等，假设图文主体至少比较大
      return rect.width > 150 && rect.height > 150 &&
             rect.bottom > 0 && rect.right > 0 &&
             rect.top < window.innerHeight && rect.left < window.innerWidth;
    });

    let bestImg = null;
    let minDistance = Infinity;
    const centerY = window.innerHeight / 2;
    const centerX = window.innerWidth / 2;

    imgs.forEach(img => {
      const rect = img.getBoundingClientRect();
      const iCenterY = rect.top + rect.height / 2;
      const iCenterX = rect.left + rect.width / 2;
      const dist = Math.pow(iCenterY - centerY, 2) + Math.pow(iCenterX - centerX, 2);
      // 同时考虑图片大小，大图片优先级更高
      const score = dist - (rect.width * rect.height * 0.01); 
      if (score < minDistance) {
        minDistance = score;
        bestImg = img;
      }
    });

    return bestImg;
  }

  /**
   * 判断当前页面是否为抖音图文模式
   */
  function isDouyinImageMode() {
    if (!location.hostname.includes('douyin.com')) return false;
    // 检测是否包含图文模式特有的 DOM 结构
    return !!(
      document.querySelector('.swiper-container[data-e2e="slide-list"]') ||
      document.querySelector('[data-e2e="slide-list"]') ||
      document.querySelector('.swiper-container .swiper-slide img[data-e2e="slide-image"]') ||
      document.querySelector('.swiper-container .swiper-slide img[data-e2e="slide-img"]') ||
      document.querySelector('.album-card-image')
    );
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
      if (isDouyinImageMode()) {
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
      if (isDouyinImageMode()) {
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
