// Netlify Function that serves every /api/* route by adapting the
// Node-style middlewares in /server (same code as the Vite dev server).
import { parkingMiddleware } from "../../server/parking.js";
import { airMiddleware } from "../../server/air.js";
import { trafficMiddleware } from "../../server/traffic.js";

const chain = (req, res, next) =>
  parkingMiddleware(req, res, () => airMiddleware(req, res, () => trafficMiddleware(req, res, next)));

export default async (request) => {
  const url = new URL(request.url);
  return new Promise((resolve) => {
    const headers = {};
    let status = 200;
    const chunks = [];
    const req = { url: url.pathname + url.search, method: request.method, headers: Object.fromEntries(request.headers) };
    const done = () => resolve(new Response(chunks.length ? Buffer.concat(chunks) : null, { status, headers }));
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      getHeader: (k) => headers[k],
      writeHead: (code, h = {}) => { status = code; Object.assign(headers, h); return res; },
      write: (c) => { chunks.push(Buffer.from(c)); return true; },
      end: (c) => { if (c) chunks.push(Buffer.from(c)); done(); },
    };
    const notFound = () => { status = 404; headers["Content-Type"] = "application/json"; chunks.push(Buffer.from('{"error":"Not found"}')); done(); };
    try { chain(req, res, notFound); } catch (e) {
      status = 500; chunks.push(Buffer.from(JSON.stringify({ error: String(e.message || e) }))); done();
    }
  });
};

export const config = { path: "/api/*" };
