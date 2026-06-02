/**
 * Generate a 256x256 PNG icon for the Forja extension.
 * No external dependencies.
 *
 * Design:
 * - Dark rounded rectangle background
 * - Orange forged "F"
 * - Gray anvil
 * - Small sparks
 *
 * Anti-aliasing:
 * - Draw at 1024x1024
 * - Downsample to 256x256
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUTPUT_SIZE = 256;
const SCALE = 4;
const SIZE = OUTPUT_SIZE * SCALE;

const pixels = Buffer.alloc(SIZE * SIZE * 4);

const BG_TOP = [31, 41, 55, 255];
const BG_BOTTOM = [17, 24, 39, 255];
const ANVIL = [209, 213, 219, 255];
const ANVIL_DARK = [107, 114, 128, 255];
const ORANGE = [249, 115, 22, 255];
const ORANGE_LIGHT = [251, 146, 60, 255];
const SPARK = [251, 191, 36, 255];
const TRANSPARENT = [0, 0, 0, 0];

function S(v) {
    return Math.round(v * SCALE);
}

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

function blendColor(a, b, t) {
    return [
        Math.round(a[0] * (1 - t) + b[0] * t),
        Math.round(a[1] * (1 - t) + b[1] * t),
        Math.round(a[2] * (1 - t) + b[2] * t),
        Math.round(a[3] * (1 - t) + b[3] * t)
    ];
}

function pointInPolygon(x, y, points) {
    let inside = false;

    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i][0];
        const yi = points[i][1];
        const xj = points[j][0];
        const yj = points[j][1];

        const intersect =
            ((yi > y) !== (yj > y)) &&
            x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

        if (intersect) inside = !inside;
    }

    return inside;
}

function drawPolygon(points, color) {
    let minX = SIZE;
    let minY = SIZE;
    let maxX = 0;
    let maxY = 0;

    for (const [x, y] of points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }

    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
            if (pointInPolygon(x + 0.5, y + 0.5, points)) {
                setPixel(x, y, color);
            }
        }
    }
}

function drawCircle(cx, cy, r, color) {
    for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
            if (dist(x, y, cx, cy) <= r) {
                setPixel(x, y, color);
            }
        }
    }
}

function drawLine(x1, y1, x2, y2, thickness, color) {
    const minX = Math.floor(Math.min(x1, x2) - thickness);
    const maxX = Math.ceil(Math.max(x1, x2) + thickness);
    const minY = Math.floor(Math.min(y1, y2) - thickness);
    const maxY = Math.ceil(Math.max(y1, y2) + thickness);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const t = Math.max(
                0,
                Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq)
            );

            const px = x1 + t * dx;
            const py = y1 + t * dy;

            if (dist(x, y, px, py) <= thickness) {
                setPixel(x, y, color);
            }
        }
    }
}

// Background
const margin = S(8);
const radius = S(42);

for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        const inX = x >= margin && x < SIZE - margin;
        const inY = y >= margin && y < SIZE - margin;

        if (!inX || !inY) {
            setPixel(x, y, TRANSPARENT);
            continue;
        }

        let inside = true;

        const left = margin;
        const right = SIZE - margin - 1;
        const top = margin;
        const bottom = SIZE - margin - 1;

        if (x < left + radius && y < top + radius) {
            inside = dist(x, y, left + radius, top + radius) <= radius;
        } else if (x > right - radius && y < top + radius) {
            inside = dist(x, y, right - radius, top + radius) <= radius;
        } else if (x < left + radius && y > bottom - radius) {
            inside = dist(x, y, left + radius, bottom - radius) <= radius;
        } else if (x > right - radius && y > bottom - radius) {
            inside = dist(x, y, right - radius, bottom - radius) <= radius;
        }

        if (inside) {
            const t = (y - margin) / (SIZE - 2 * margin);
            setPixel(x, y, blendColor(BG_TOP, BG_BOTTOM, t));
        } else {
            setPixel(x, y, TRANSPARENT);
        }
    }
}

// Sparks
drawLine(S(86), S(122), S(58), S(104), S(2.4), SPARK);
drawLine(S(92), S(116), S(78), S(82), S(2.4), SPARK);
drawLine(S(106), S(112), S(106), S(76), S(2.4), SPARK);
drawLine(S(92), S(134), S(58), S(138), S(2.4), SPARK);

drawCircle(S(72), S(118), S(3), SPARK);
drawCircle(S(92), S(92), S(3), SPARK);
drawCircle(S(62), S(132), S(3), SPARK);

// Anvil top
drawPolygon([
    [S(52), S(140)],
    [S(204), S(140)],
    [S(188), S(158)],
    [S(154), S(158)],
    [S(146), S(170)],
    [S(110), S(170)],
    [S(102), S(158)],
    [S(70), S(158)]
], ANVIL);

// Anvil body
drawPolygon([
    [S(96), S(170)],
    [S(160), S(170)],
    [S(176), S(202)],
    [S(80), S(202)]
], ANVIL_DARK);

// Anvil base
drawPolygon([
    [S(66), S(202)],
    [S(190), S(202)],
    [S(202), S(218)],
    [S(54), S(218)]
], ANVIL);

// Main Forja F
drawPolygon([
    [S(112), S(52)],
    [S(188), S(52)],
    [S(174), S(72)],
    [S(132), S(72)],

    [S(128), S(94)],
    [S(170), S(94)],
    [S(158), S(112)],
    [S(124), S(112)],

    [S(114), S(168)],
    [S(94), S(168)]
], ORANGE);

// F highlight
drawPolygon([
    [S(116), S(52)],
    [S(188), S(52)],
    [S(176), S(64)],
    [S(130), S(64)],
    [S(126), S(86)],
    [S(122), S(86)]
], ORANGE_LIGHT);

// Forge point
drawPolygon([
    [S(114), S(168)],
    [S(126), S(112)],
    [S(134), S(112)],
    [S(124), S(176)]
], ORANGE);

// Downsample 1024 -> 256
function downsampleTo256() {
    const out = Buffer.alloc(OUTPUT_SIZE * OUTPUT_SIZE * 4);

    for (let y = 0; y < OUTPUT_SIZE; y++) {
        for (let x = 0; x < OUTPUT_SIZE; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;

            for (let yy = 0; yy < SCALE; yy++) {
                for (let xx = 0; xx < SCALE; xx++) {
                    const sx = x * SCALE + xx;
                    const sy = y * SCALE + yy;
                    const i = (sy * SIZE + sx) * 4;

                    r += pixels[i];
                    g += pixels[i + 1];
                    b += pixels[i + 2];
                    a += pixels[i + 3];
                }
            }

            const count = SCALE * SCALE;
            const oi = (y * OUTPUT_SIZE + x) * 4;

            out[oi] = Math.round(r / count);
            out[oi + 1] = Math.round(g / count);
            out[oi + 2] = Math.round(b / count);
            out[oi + 3] = Math.round(a / count);
        }
    }

    return out;
}

// PNG encoding
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

const finalPixels = downsampleTo256();

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUTPUT_SIZE, 0);
ihdr.writeUInt32BE(OUTPUT_SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(OUTPUT_SIZE * (OUTPUT_SIZE * 4 + 1));

for (let y = 0; y < OUTPUT_SIZE; y++) {
    raw[y * (OUTPUT_SIZE * 4 + 1)] = 0;

    finalPixels.copy(
        raw,
        y * (OUTPUT_SIZE * 4 + 1) + 1,
        y * OUTPUT_SIZE * 4,
        (y + 1) * OUTPUT_SIZE * 4
    );
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

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);

console.log(`Generated: ${outPath} (${png.length} bytes)`);