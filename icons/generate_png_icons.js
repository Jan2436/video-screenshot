// generate_png_icons.js
// 使用 Node.js 生成 PNG 图标文件
// 运行: node generate_png_icons.js

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size;
  const r = s * 0.18;

  // Background
  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#0f3460');
  grad.addColorStop(1, '#533483');
  ctx.beginPath();
  ctx.roundRect(0, 0, s, s, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // Play triangle
  ctx.beginPath();
  ctx.moveTo(s*0.32, s*0.22);
  ctx.lineTo(s*0.32, s*0.72);
  ctx.lineTo(s*0.75, s*0.47);
  ctx.closePath();
  ctx.fillStyle = '#e94560';
  ctx.fill();

  // Speed text
  ctx.fillStyle = '#7ec8e3';
  ctx.font = `bold ${s*0.14}px Arial`;
  ctx.textAlign = 'center';
  ctx.fillText('3x', s*0.5, s*0.38);

  // Camera body
  const camY = s*0.62;
  const camH = s*0.26;
  const camW = s*0.44;
  const camX = s*0.28;
  ctx.strokeStyle = '#4ecca3';
  ctx.lineWidth = Math.max(1, s*0.02);
  ctx.beginPath();
  ctx.roundRect(camX, camY, camW, camH, s*0.03);
  ctx.stroke();

  // Camera lens
  ctx.beginPath();
  ctx.arc(s*0.5, camY + camH*0.55, s*0.07, 0, Math.PI*2);
  ctx.stroke();

  // Camera top
  ctx.fillStyle = '#4ecca3';
  ctx.beginPath();
  ctx.roundRect(s*0.4, camY - s*0.04, s*0.2, s*0.05, s*0.02);
  ctx.fill();

  return canvas;
}

const sizes = [16, 48, 128];
const outDir = path.join(__dirname);

sizes.forEach(size => {
  const canvas = drawIcon(size);
  const buffer = canvas.toBuffer('image/png');
  const filename = `icon${size}.png`;
  fs.writeFileSync(path.join(outDir, filename), buffer);
  console.log(`Generated ${filename}`);
});

console.log('Done!');
