import { existsSync } from "node:fs";
import { ALERT_CITIES } from "../shared/alertCities.js";
import { createAlertService } from "./alerts/service.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const getAlerts = createAlertService();

export function alertsMiddleware(req, res, next) {
  const match = req.url?.match(/^\/api\/alerts\/([a-z]+)$/);
  if (!match) return next();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!Object.hasOwn(ALERT_CITIES, match[1])) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Unsupported alert city." }));
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end(JSON.stringify({ error: "GET required." }));
    return;
  }
  getAlerts(match[1])
    .then((result) => res.end(JSON.stringify(result)))
    .catch(() => {
      res.writeHead(503);
      res.end(
        JSON.stringify({
          error: "Alert cache unavailable. Please retry later.",
        }),
      );
    });
}

export const alertsPlugin = {
  name: "cached-city-alerts",
  configureServer(server) {
    server.middlewares.use(alertsMiddleware);
  },
  configurePreviewServer(server) {
    server.middlewares.use(alertsMiddleware);
  },
};
