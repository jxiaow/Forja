/**
 * Generate a 128x128 PNG icon for the extension.
 * Uses raw PNG encoding (no external dependencies).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// Create RGBA pixel buffer
const pixels = Buffer.alloc(SIZE * SIZE * 4);

// Colors
const BG = [65, 205, 82, 255];       // Qt green #41cd52
const WHITE = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

function setPixel(x, y, color) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3];
}

function dist(x1, y1, x2, y2) {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// Draw rounded rectangle background
for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        const margin = 8;
        const radius = 48;
        const inX = x >= margin && x < SIZE - margin;
        const inY = y >= margin && y < SIZE - margin;

        if (!inX || !inY) { setPixel(x, y, TRANSPARENT); continue; }

        // Check corners
        let inside = true;
        const corners = [
            [margin + radius, margin + radius],
            [SIZE - margin - radius - 1, margin + radius],
            [margin + radius, SIZE - margin - radius - 1],
            [SIZE - margin - radius - 1, SIZE - margin - radius - 1]
        ];

        if (x < margin + radius && y < margin + radius) {
            inside = dist(x, y, corners[0][0], corners[0][1]) <= radius;
        } else if (x >= SIZE - margin - radius && y < margin + radius) {
            inside = dist(x, y, corners[1][0], corners[1][1]) <= radius;
        } else if (x < margin + radius && y >= SIZE - margin - radius) {
            inside = dist(x, y, corners[2][0], corners[2][1]) <= radius;
        } else if (x >= SIZE - margin - radius && y >= SIZE - margin - radius) {
            inside = dist(x, y, corners[3][0], corners[3][1]) <= radius;
        }

        setPixel(x, y, inside ? BG : TRANSPARENT);
    }
}

// Draw "Q" circle (center 116, 116, radius 60, stroke 16)
const cx = 116, cy = 116, r = 60, stroke = 16;
for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        const d = dist(x, y, cx, cy);
        if (d >= r - stroke / 2 && d <= r + stroke / 2) {
            setPixel(x, y, WHITE);
        }
    }
}

// Draw Q tail (line from 152,152 to 200,200, width 16)
for (let t = 0; t <= 1; t += 0.001) {
    const lx = 152 + (200 - 152) * t;
    const ly = 152 + (200 - 152) * t;
    for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
            if (dx * dx + dy * dy <= 64) {
                setPixel(Math.round(lx + dx), Math.round(ly + dy), WHITE);
            }
        }
    }
}

// Draw play triangle (vertices: 100,88  148,116  100,144)
for (let y = 88; y <= 144; y++) {
    for (let x = 100; x <= 148; x++) {
        // Point in triangle test
        const x0 = 100, y0 = 88, x1 = 148, y1 = 116, x2 = 100, y2 = 144;
        const area = 0.5 * (-y1 * x2 + y0 * (-x1 + x2) + x0 * (y1 - y2) + x1 * y2);
        const s = (y0 * x2 - x0 * y2 + (y2 - y0) * x + (x0 - x2) * y) / (2 * area);
        const t2 = (x0 * y1 - y0 * x1 + (y0 - y1) * x + (x1 - x0) * y) / (2 * area);
        if (s >= 0 && t2 >= 0 && (s + t2) <= 1) {
            setPixel(x, y, WHITE);
        }
    }
}

// Encode as PNG
function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crc]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// IDAT - raw image data with filter bytes
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0; // no filter
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const compressed = zlib.deflateSync(raw);

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
]);

const outPath = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(outPath, png);
console.log(`Generated: ${outPath} (${png.length} bytes)`);
