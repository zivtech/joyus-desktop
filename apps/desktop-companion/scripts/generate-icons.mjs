#!/usr/bin/env node

/**
 * Generate Tauri app icons from a 1024x1024 source PNG.
 *
 * Usage:
 *   node scripts/generate-icons.mjs [path/to/source-1024x1024.png]
 *
 * If no source is provided, generates placeholder icons using solid colour + text
 * so the build pipeline can proceed without external artwork.
 *
 * Outputs to src-tauri/icons/:
 *   32x32.png, 128x128.png, 128x128@2x.png, icon.icns, icon.ico,
 *   tray-normal.png, tray-warning.png, tray-error.png
 *
 * For production: provide a real 1024x1024 PNG source, or use `cargo tauri icon`
 * once Rust tooling is available on the build host.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "..", "src-tauri", "icons");
const SIZES = [
  { name: "32x32.png", size: 32 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
];
const TRAY_ICONS = [
  { name: "tray-normal.png", size: 22, color: "#1a73e8" },
  { name: "tray-warning.png", size: 22, color: "#f59e0b" },
  { name: "tray-error.png", size: 22, color: "#ef4444" },
];

function hasSips() {
  try {
    execFileSync("which", ["sips"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasIconutil() {
  try {
    execFileSync("which", ["iconutil"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a minimal valid PNG file with a solid colour.
 * This produces a real PNG (not just a header) using the simplest
 * uncompressed IDAT approach via zlib-stored blocks.
 */
function createMinimalPng(width, height, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crc]);
  }

  // IHDR: width, height, bit depth 8, colour type 2 (RGB), compression 0, filter 0, interlace 0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // colour type RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk("IHDR", ihdrData);

  // Raw image data: each row = filter byte (0) + RGB pixels
  const rowSize = 1 + width * 3;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowSize;
    rawData[offset] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }

  // Wrap in zlib stored blocks (no compression — simple and correct)
  // Zlib header: CMF=0x78 FLG=0x01 (deflate, no dict, check bits)
  const zlibHeader = Buffer.from([0x78, 0x01]);

  // Split into 65535-byte stored blocks
  const blocks = [];
  let pos = 0;
  while (pos < rawData.length) {
    const remaining = rawData.length - pos;
    const blockSize = Math.min(remaining, 65535);
    const isLast = pos + blockSize >= rawData.length;

    const blockHeader = Buffer.alloc(5);
    blockHeader[0] = isLast ? 0x01 : 0x00;
    blockHeader.writeUInt16LE(blockSize, 1);
    blockHeader.writeUInt16LE(blockSize ^ 0xffff, 3);

    blocks.push(blockHeader);
    blocks.push(rawData.subarray(pos, pos + blockSize));
    pos += blockSize;
  }

  // Adler-32 checksum of raw data
  let s1 = 1, s2 = 0;
  for (let i = 0; i < rawData.length; i++) {
    s1 = (s1 + rawData[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE((s2 * 65536 + s1) >>> 0);

  const compressedData = Buffer.concat([zlibHeader, ...blocks, adler]);
  const idat = makeChunk("IDAT", compressedData);

  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function generatePlaceholderPng(size, hexColor) {
  const { r, g, b } = hexToRgb(hexColor);
  return createMinimalPng(size, size, r, g, b);
}

function generateFromSource(sourcePath) {
  if (!existsSync(sourcePath)) {
    console.error(`Source image not found: ${sourcePath}`);
    process.exit(1);
  }

  if (!hasSips()) {
    console.error("sips not available — cannot resize source image (macOS only).");
    console.error("Use `cargo tauri icon` instead, or run on macOS.");
    process.exit(1);
  }

  // Generate PNGs via sips
  for (const { name, size } of [...SIZES, ...TRAY_ICONS.map((t) => ({ name: t.name, size: t.size }))]) {
    const outPath = join(ICONS_DIR, name);
    copyFileSync(sourcePath, outPath);
    execFileSync("sips", ["-z", String(size), String(size), outPath], { stdio: "pipe" });
    console.log(`  ${name} (${size}x${size})`);
  }

  // Generate .icns via iconutil on macOS
  if (hasIconutil()) {
    const iconsetDir = join(ICONS_DIR, "icon.iconset");
    mkdirSync(iconsetDir, { recursive: true });

    const iconsetSizes = [16, 32, 64, 128, 256, 512];
    for (const s of iconsetSizes) {
      const dest = join(iconsetDir, `icon_${s}x${s}.png`);
      copyFileSync(sourcePath, dest);
      execFileSync("sips", ["-z", String(s), String(s), dest], { stdio: "pipe" });

      // @2x variant
      const dest2x = join(iconsetDir, `icon_${s / 2}x${s / 2}@2x.png`);
      if (s >= 32) {
        copyFileSync(sourcePath, dest2x);
        execFileSync("sips", ["-z", String(s), String(s), dest2x], { stdio: "pipe" });
      }
    }

    execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", join(ICONS_DIR, "icon.icns")], {
      stdio: "pipe",
    });
    // Clean up iconset directory
    execFileSync("rm", ["-rf", iconsetDir]);
    console.log("  icon.icns (macOS bundle)");
  } else {
    console.warn("  iconutil not available — skipping icon.icns generation");
  }

  // ICO generation requires external tooling; create placeholder
  console.warn("  icon.ico — placeholder (use cargo tauri icon or a converter for production)");
  const ico256 = createMinimalPng(256, 256, 0x1a, 0x73, 0xe8);
  writeFileSync(join(ICONS_DIR, "icon.ico"), ico256);
}

function generatePlaceholders() {
  console.log("Generating placeholder icons (no source image provided)...");
  console.log("For production, run: node scripts/generate-icons.mjs path/to/logo-1024.png");
  console.log("");

  const brand = "#1a73e8";

  // App icons
  for (const { name, size } of SIZES) {
    const png = generatePlaceholderPng(size, brand);
    writeFileSync(join(ICONS_DIR, name), png);
    console.log(`  ${name} (${size}x${size}) — placeholder`);
  }

  // 1024x1024 source for icns/ico
  const source1024 = generatePlaceholderPng(1024, brand);
  writeFileSync(join(ICONS_DIR, "icon.png"), source1024);
  console.log("  icon.png (1024x1024) — placeholder source");

  // .icns — write the 128x128 PNG as a stand-in; real icns needs iconutil or cargo tauri icon
  const icns128 = generatePlaceholderPng(128, brand);
  writeFileSync(join(ICONS_DIR, "icon.icns"), icns128);
  console.log("  icon.icns — placeholder (use cargo tauri icon for production)");

  // .ico — write 256x256 PNG as stand-in
  const ico256 = generatePlaceholderPng(256, brand);
  writeFileSync(join(ICONS_DIR, "icon.ico"), ico256);
  console.log("  icon.ico — placeholder (use cargo tauri icon for production)");

  // Tray icons
  for (const { name, size, color } of TRAY_ICONS) {
    const png = generatePlaceholderPng(size, color);
    writeFileSync(join(ICONS_DIR, name), png);
    console.log(`  ${name} (${size}x${size}) — placeholder`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

mkdirSync(ICONS_DIR, { recursive: true });

const sourceArg = process.argv[2];

if (sourceArg) {
  console.log(`Generating icons from source: ${sourceArg}`);
  generateFromSource(sourceArg);
} else {
  generatePlaceholders();
}

console.log("\nDone. Icons written to src-tauri/icons/");
