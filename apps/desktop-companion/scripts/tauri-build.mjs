import { spawnSync } from "node:child_process";

// linuxdeploy bundles an old `strip` that cannot read the `.relr.dyn` sections
// in libraries from rolling-release distros (e.g. Arch), which fails the
// AppImage bundle. Skip stripping on Linux unless the caller set NO_STRIP.
const env = { ...process.env };
if (process.platform === "linux" && env.NO_STRIP === undefined) {
  env.NO_STRIP = "true";
}

const result = spawnSync("cargo", ["tauri", "build", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
