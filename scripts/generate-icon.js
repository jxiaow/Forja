/**
 * Generate a 256x256 PNG icon for the Compilot extension.
 * Uses raw PNG encoding (no external dependencies).
 *
 * Design: Indigo rounded rect background + white "C" with gear teeth accent
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// Create RGBA pixel buffer
const pixels = Buffer.alloc(SIZE * SIZE * 4);

// Colors
const BG = [55, 71, 133, 255];        // Indigo blue #374785
const ACCENT = [44, 62, 120, 255];    // Darker accent for depth
const WHITE = [255, 255, 255, 255];
const HIGHLIGHT = [99, 179, 237, 255]; // Light blue accent #63B3ED
const TRANSPARENT = [0, 0, 0, 0];

function setPixel(x, y, color) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3];
}

function getPixel(x, y) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return TRANSPARENT;
    const i = (y * SIZE + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

function dist(x1, y1, x2, y2) {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function blendColor(base, overlay, alpha) {
    return [
        Math.round(base[0] * (1 - alpha) + overlay[0] * alpha),
        Math.round(base[1] * (1 - alpha) + overlay[1] * alpha),
        Math.round(base[2] * (1 - alpha) + overlay[2] * alpha),
        255
    ];
}

// Draw rounded rectangle background with subtle gradient
const margin = 8;
const radius = 48;

for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        const inX = x >= margin && x < SIZE - margin;
        const inY = y >= margin && y < SIZE - margin;

        if (!inX || !inY) { setPixel(x, y, TRANSPARENT); continue; }

        // Check corners for rounded rect
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

        if (inside) {
            // Subtle vertical gradient
            const gradientT = (y - margin) / (SIZE - 2 * margin);
            const color = blendColor(BG, ACCENT, gradientT * 0.4);
            setPixel(x, y, color);
        } else {
            setPixel(x, y, TRANSPARENT);
        }
    }
}

// Draw "C" letter (arc) - center at 120, 128, outer radius 68, inner radius 48
const cx = 120, cy = 128;
const outerR = 68, innerR = 48;
const gapAngle = Math.PI * 0.35; // Opening angle on the right side

for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        const d = dist(x, y, cx, cy);
        if (d >= innerR && d <= outerR) {
            // Check if we're in the gap (right side opening)
            const angle = Math.atan2(y - cy, x - cx);
            if (Math.abs(angle) < gapAngle) continue; // Skip the gap
            setPixel(x, y, WHITE);
        }
    }
}

// Draw small gear/cog in the opening of the C (bottom-right area)
const gearCx = 178, gearCy = 148;
const gearOuterR = 24, gearInnerR = 14;
const gearTeeth = 8;
const toothHeight = 8;

for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        const d = dist(x, y, gearCx, gearCy);
        const angle = Math.atan2(y - gearCy, x - gearCx);

        // Gear body (ring)
        if (d >= gearInnerR && d <= gearOuterR) {
            setPixel(x, y, HIGHLIGHT);
        }

        // Gear teeth
        if (d > gearOuterR && d <= gearOuterR + toothHeight) {
            const toothAngle = (angle + Math.PI) / (2 * Math.PI) * gearTeeth;
            const toothPhase = toothAngle - Math.floor(toothAngle);
            if (toothPhase > 0.25 && toothPhase < 0.75) {
                setPixel(x, y, HIGHLIGHT);
            }
        }

        // Center hole
        if (d < 7) {
            // Restore background
            const gradientT = (y - margin) / (SIZE - 2 * margin);
            const color = blendColor(BG, ACCENT, gradientT * 0.4);
            setPixel(x, y, color);
        }
    }
}

// Draw a small "play" triangle inside the C (subtle, represents "run")
const triCx = 126, triCy = 128;
const triSize = 16;
for (let y = triCy - triSize; y <= triCy + triSize; y++) {
    for (let x = triCx - triSize; x <= triCx + triSize; x++) {
        // Triangle pointing right: left vertex at (triCx-8, triCy-12), (triCx-8, triCy+12), (triCx+12, triCy)
        const x0 = triCx - 8, y0 = triCy - 12;
        const x1 = triCx + 12, y1 = triCy;
        const x2 = triCx - 8, y2 = triCy + 12;
        const area = 0.5 * (-y1 * x2 + y0 * (-x1 + x2) + x0 * (y1 - y2) + x1 * y2);
        const s = (y0 * x2 - x0 * y2 + (y2 - y0) * x + (x0 - x2) * y) / (2 * area);
        const t = (x0 * y1 - y0 * x1 + (y0 - y1) * x + (x1 - x0) * y) / (2 * area);
        if (s >= 0 && t >= 0 && (s + t) <= 1) {
            setPixel(x, y, HIGHLIGHT);
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

// IDAT
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
