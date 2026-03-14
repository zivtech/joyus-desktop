import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, chmod } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract as tarExtract } from "tar";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const NODE_VERSION = "v24.0.0";
const BASE_URL = `https://nodejs.org/dist/${NODE_VERSION}`;

const TARGETS = [
  {
    triple: "aarch64-apple-darwin",
    archive: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
    binaryPath: `node-${NODE_VERSION}-darwin-arm64/bin/node`,
    ext: "",
  },
  {
    triple: "x86_64-apple-darwin",
    archive: `node-${NODE_VERSION}-darwin-x64.tar.gz`,
    binaryPath: `node-${NODE_VERSION}-darwin-x64/bin/node`,
    ext: "",
  },
  {
    triple: "x86_64-pc-windows-msvc",
    archive: `node-${NODE_VERSION}-win-x64.zip`,
    binaryPath: `node-${NODE_VERSION}-win-x64/node.exe`,
    ext: ".exe",
  },
];

const binariesDir = resolve("binaries");

async function downloadFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const writer = createWriteStream(destPath);
  await pipeline(response.body, writer);
}

async function extractTarGz(archivePath, outputDir) {
  await tarExtract({ file: archivePath, cwd: outputDir });
}

async function extractZip(archivePath, outputDir) {
  execSync(`unzip -o "${archivePath}" -d "${outputDir}"`, { stdio: "pipe" });
}

async function downloadTarget(target) {
  const url = `${BASE_URL}/${target.archive}`;
  const tmpDir = join(binariesDir, `tmp-${target.triple}`);
  const archivePath = join(tmpDir, target.archive);

  await mkdir(tmpDir, { recursive: true });

  console.log(`Downloading ${url}...`);
  await downloadFile(url, archivePath);

  console.log(`Extracting ${target.archive}...`);
  if (target.archive.endsWith(".tar.gz")) {
    await extractTarGz(archivePath, tmpDir);
  } else {
    await extractZip(archivePath, tmpDir);
  }

  const extractedBinary = join(tmpDir, target.binaryPath);
  const outputName = `node-${target.triple}${target.ext}`;
  const outputPath = join(binariesDir, outputName);

  await rename(extractedBinary, outputPath);
  if (!target.ext) {
    await chmod(outputPath, 0o755);
  }

  await rm(tmpDir, { recursive: true, force: true });
  console.log(`Installed ${outputName}`);
}

await mkdir(binariesDir, { recursive: true });

for (const target of TARGETS) {
  await downloadTarget(target);
}

console.log("All Node.js binaries downloaded successfully.");
