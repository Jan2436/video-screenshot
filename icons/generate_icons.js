// generate_icons.js - 使用纯 Node.js 生成简单 PNG 图标
// 无需外部依赖，生成最小有效 PNG

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size, r, g, b) {
  // 创建简单的纯色 PNG 图标
  const width = size;
  const height = size;

  // PNG 签名
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk - image data
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter: none
    for (let x = 0; x < width; x++) {
      // 创建圆角矩形图标
      const margin = size * 0.1;
      const radius = size * 0.2;
      const inside = x >= margin && x < width - margin && y >= margin && y < height - margin;

      // 简单渐变效果
      const t = (x + y) / (2 * size);
      const cr = Math.round(r * (1 - t) + 83 * t);
      const cg = Math.round(g * (1 - t) + 52 * t);
      const cb = Math.round(b * (1 - t) + 131 * t);

      if (inside) {
        rawData.push(cr, cg, cb);
      } else {
        rawData.push(0, 0, 0); // 透明区域用黑色（简单处理）
      }
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(rawData));
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 生成图标 - 使用深蓝紫色 (#0f3460)
const sizes = [16, 48, 128];
const outDir = path.join(__dirname);

sizes.forEach(size => {
  const png = createPNG(size, 15, 52, 96);
  const filename = `icon${size}.png`;
  fs.writeFileSync(path.join(outDir, filename), png);
  console.log(`Generated ${filename} (${png.length} bytes)`);
});

console.log('Done! Icons generated in:', outDir);
