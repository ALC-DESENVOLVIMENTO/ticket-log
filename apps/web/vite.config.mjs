import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
const allowedHosts = ["web-ticketlog.up.railway.app"];

if (railwayDomain && !allowedHosts.includes(railwayDomain)) {
  allowedHosts.push(railwayDomain);
}

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts,
  },
});
