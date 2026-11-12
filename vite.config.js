import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { parkingPlugin } from "./server/parking.js";
import { airPlugin } from "./server/air.js";
import { trafficPlugin } from "./server/traffic.js";
export default defineConfig({
  plugins: [react(), parkingPlugin, airPlugin, trafficPlugin],
});
