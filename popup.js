// popup.js

const slider = document.getElementById('slider');
const speedNum = document.getElementById('speedNum');
const captureBtn = document.getElementById('captureBtn');
const status = document.getElementById('status');
const presets = document.querySelectorAll('.preset');
const fmts = document.querySelectorAll('.fmt');

let currentFormat = 'png';
let currentSpeed = 1.0;

// ---- 通信 ----

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(action, data = {}) {
  const tab = await getTab();
  if (!tab) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { action, ...data });
  } catch {
    return null;
  }
}

// ---- 速度 ----

function updateDisplay(speed) {
  currentSpeed = speed;
  speedNum.textContent = speed.toFixed(1);
  slider.value = speed;
  presets.forEach(b => {
    b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
  });
}

async function setSpeed(speed) {
  speed = Math.round(Math.max(0.1, Math.min(3, speed)) * 10) / 10;
  updateDisplay(speed);
  const r = await send('setSpeed', { speed });
  if (r && r.success) {
    status.textContent = `${speed.toFixed(1)}×`;
    status.className = 'status ok';
  } else {
    status.textContent = '未检测到视频';
    status.className = 'status err';
  }
}

// 滑块拖动实时更新
slider.addEventListener('input', () => {
  const speed = parseFloat(slider.value);
  currentSpeed = speed;
  speedNum.textContent = speed.toFixed(1);
  presets.forEach(b => {
    b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
  });
  send('setSpeed', { speed });
});

// 预设按钮
presets.forEach(b => {
  b.addEventListener('click', () => setSpeed(parseFloat(b.dataset.speed)));
});

// ---- 截图 ----

async function capture() {
  captureBtn.disabled = true;
  captureBtn.textContent = '截图中…';
  const r = await send('screenshot', { format: currentFormat });
  if (r && r.success) {
    status.textContent = `已保存 ${r.width}×${r.height}`;
    status.className = 'status ok';
  } else {
    status.textContent = '截图失败';
    status.className = 'status err';
  }
  captureBtn.disabled = false;
  captureBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
    截取当前帧`;
}

captureBtn.addEventListener('click', capture);

// 格式选择
fmts.forEach(b => {
  b.addEventListener('click', () => {
    fmts.forEach(f => f.classList.remove('active'));
    b.classList.add('active');
    currentFormat = b.dataset.format;
  });
});

// ---- 键盘 ----
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowUp') { e.preventDefault(); setSpeed(currentSpeed + 0.1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setSpeed(currentSpeed - 0.1); }
  else if (e.key === 's' || e.key === 'S') { e.preventDefault(); capture(); }
});

// ---- 初始化 ----
(async () => {
  const r = await send('getStatus');
  if (r && r.hasVideo) {
    updateDisplay(r.speed || 1.0);
    status.textContent = `${r.videoCount} 个视频 · ${(r.speed || 1).toFixed(1)}×`;
    status.className = 'status ok';
  } else {
    status.textContent = '未检测到视频';
    status.className = 'status err';
  }
})();
