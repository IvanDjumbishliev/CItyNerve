// Builds ONE self-contained folder (netlify-upload/) for drag-and-drop to Netlify.
import { build } from "esbuild";
import { cpSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
const out = "netlify-upload";
rmSync(out, { recursive: true, force: true });
cpSync("dist", out, { recursive: true });
mkdirSync(`${out}/netlify/functions`, { recursive: true });
await build({
  entryPoints: ["netlify/functions/api.mjs"],
  outfile: `${out}/netlify/functions/api.mjs`,
  bundle: true, platform: "node", format: "esm", target: "node22",
  banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" },
});
writeFileSync(`${out}/_redirects`, "/*  /index.html  200\n");
writeFileSync(`${out}/netlify.toml`, '[functions]\n  directory = "netlify/functions"\n  node_bundler = "esbuild"\n');
console.log("ready:", out);
