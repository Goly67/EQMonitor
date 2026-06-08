import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".geojson": "application/geo+json",
  ".webmanifest": "application/manifest+json",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const resolved = path.normalize(path.join(__dirname, decoded));
  if (!resolved.startsWith(__dirname)) return null;
  return resolved;
}

async function serveStatic(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";
  const data = await fs.readFile(filePath);
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url === "/" ? "/index.html" : req.url;

    if (urlPath === "/api/faultlines") {
      const filePath = path.join(__dirname, "faultlines.json");
      const fileData = await fs.readFile(filePath, "utf8");
      const geojson = JSON.parse(fileData);
      if (!geojson.type || !geojson.features) {
        throw new Error("Invalid GeoJSON structure");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(geojson));
      return;
    }

    const filePath = safePath(urlPath);
    if (!filePath) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        await serveStatic(path.join(filePath, "index.html"), res);
      } else {
        await serveStatic(filePath, res);
      }
    } catch {
      res.writeHead(404).end("Not found");
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500).end("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`EQMonitor running at http://localhost:${PORT}`);
});
