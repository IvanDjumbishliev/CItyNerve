import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { parkingPlugin } from "./server/parking.js";
export default defineConfig({ plugins: [react(), parkingPlugin] });
