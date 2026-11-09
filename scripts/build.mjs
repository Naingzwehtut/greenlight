// Bundles the GitHub Action entry and the CLI into self-contained files in dist/.
// GitHub Actions runs dist/index.js directly, so it must include all dependencies.
import { build } from "esbuild";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  legalComments: "none",
  // Some CJS dependencies call require(); give ESM bundles a working one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
};

await build({ ...shared, entryPoints: ["src/action.ts"], outfile: "dist/index.js" });
await build({
  ...shared,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node\n" + shared.banner.js },
});

console.log("built dist/index.js and dist/cli.js");
