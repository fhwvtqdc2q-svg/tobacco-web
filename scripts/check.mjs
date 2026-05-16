import { existsSync, readFileSync } from "node:fs";

const required = [
  "index.html",
  "src/app.js",
  "src/config.js",
  "src/supabase-client.js",
  "src/styles.css",
  "public/manifest.webmanifest",
  "public/service-worker.js"
];

let failed = false;

for (const file of required) {
  if (!existsSync(file)) {
    console.error(`Missing: ${file}`);
    failed = true;
  }
}

const html = readFileSync("index.html", "utf8");
if (!html.includes('id="app"')) {
  console.error("index.html is missing #app root.");
  failed = true;
}

if (!html.includes("supabase-client.js")) {
  console.error("index.html is missing Supabase client wiring.");
  failed = true;
}

const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
if (!manifest.name || !manifest.start_url) {
  console.error("manifest.webmanifest is incomplete.");
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("Project check passed.");
