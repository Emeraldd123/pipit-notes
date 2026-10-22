// Generates the PWA icons (PNG) with no dependencies: a rounded green tile with a
// white handwritten stroke. Run: node tools/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const GREEN = [61, 82, 68];
const WHITE = [255, 255, 255];

// A flowing handwritten stroke (cubic bezier chain) in a 0..1 box, plus a nib dot.
function strokePoints() {
  const seg = (p0, p1, p2, p3, n = 60) => Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  });
  return [
    ...seg([0.26, 0.64], [0.30, 0.30], [0.50, 0.26], [0.50, 0.50]),
    ...seg([0.50, 0.50], [0.50, 0.74], [0.70, 0.72], [0.74, 0.36]),
  ];
}

function render(size, { maskable }) {
  const px = new Uint8Array(size * size * 4);
  const pts = strokePoints().map(([x, y]) => [x * size, y * size]);
  const half = size * 0.052; // half stroke width
  const radius = maskable ? 0 : size * 0.22;
  const nib = [0.74 * size, 0.30 * size];
  const nibR = size * 0.045;
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
          // inside rounded rect?
          const dx = Math.max(radius - fx, 0, fx - (size - radius));
          const dy = Math.max(radius - fy, 0, fy - (size - radius));
          if (Math.hypot(dx, dy) > radius) continue;
          // distance to stroke polyline
          let d = Infinity;
          for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
            const vx = x1 - x0, vy = y1 - y0;
            const l2 = vx * vx + vy * vy || 1;
            const t = Math.max(0, Math.min(1, ((fx - x0) * vx + (fy - y0) * vy) / l2));
            d = Math.min(d, Math.hypot(fx - (x0 + t * vx), fy - (y0 + t * vy)));
          }
          const onInk = d <= half || Math.hypot(fx - nib[0], fy - nib[1]) <= nibR;
          const c = onInk ? WHITE : GREEN;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS, o = (y * size + x) * 4;
      const cov = a / (255 * n);
      px[o] = cov ? r / (cov * n) : 0; px[o + 1] = cov ? g / (cov * n) : 0; px[o + 2] = cov ? b / (cov * n) : 0; px[o + 3] = Math.round(cov * 255);
    }
  }
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, opts) {
  const px = render(size, opts);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync("public/icon-192.png", png(192, { maskable: false }));
writeFileSync("public/icon-512.png", png(512, { maskable: false }));
writeFileSync("public/icon-maskable-512.png", png(512, { maskable: true }));
writeFileSync("public/apple-touch-icon.png", png(180, { maskable: true })); // iOS rounds it itself

writeFileSync(
  "public/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#3d5244"/><path d="M26 64 C30 30 50 26 50 50 C50 74 70 72 74 36" fill="none" stroke="#fff" stroke-width="10.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="74" cy="30" r="4.5" fill="#fff"/></svg>`
);
console.log("icons written");
