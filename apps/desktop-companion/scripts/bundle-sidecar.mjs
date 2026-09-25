import { build } from "esbuild";

await build({
  entryPoints: ["src/sidecar/entry.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: "binaries/sidecar-main.mjs",
  banner: { js: "#!/usr/bin/env node" },
});
