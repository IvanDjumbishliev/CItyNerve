import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { parkingMiddleware } from "./parking.js";
import { airMiddleware } from "./air.js";
import { trafficMiddleware } from "./traffic.js";
const root = resolve("dist");
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".geojson": "application/geo+json",
};
const api = (req, res, next) =>
  parkingMiddleware(req, res, () => airMiddleware(req, res, () => trafficMiddleware(req, res, next)));
createServer((req, res) =>
  api(req, res, async () => {
    try {
      const path = resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
      if (path !== root && !path.startsWith(root + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const target = extname(path) ? path : resolve(root, "index.html");
      const body = await readFile(target);
      res.setHeader("Content-Type", types[extname(target)] || "application/octet-stream");
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  }),
).listen(Number(process.env.PORT) || 3000);
