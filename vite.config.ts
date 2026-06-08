import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    base: "./",
    plugins: [react()],
    server: {
        host: true,
    },
    // @novasamatech/host-api is reached only through a runtime dynamic import
    // deep in the cloud-storage/host SDK chain (first hit on image upload /
    // deploy), so Vite's startup scan misses it and re-optimizes mid-action —
    // which 404s the in-flight dynamic import ("Failed to fetch dynamically
    // imported module"). Pre-bundle it so it's in the initial optimize pass.
    optimizeDeps: {
        include: ["@novasamatech/host-api"],
    },
});
