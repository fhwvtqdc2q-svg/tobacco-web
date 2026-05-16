import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));
const portArgIndex = process.argv.indexOf("--port");
const requestedPort = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 5173;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const clean = decoded === "/" ? "/index.html" : decoded;
  const target = normalize(join(root, clean));
  return target.startsWith(root) ? target : join(root, "index.html");
}

function handler(req, res) {
  let target = safePath(req.url || "/");

  if (!existsSync(target) || statSync(target).isDirectory()) {
    target = join(root, "index.html");
  }

  res.setHeader("Content-Type", types[extname(target)] || "application/octet-stream");
  createReadStream(target).pipe(res);
}

const server = createServer(handler);

server.listen(requestedPort, "0.0.0.0", () => {
  console.log(`Web Platform is running:`);
  console.log(`Local:   http://localhost:${requestedPort}`);
  console.log(`Network: http://YOUR_WINDOWS_IP:${requestedPort}`);
});
