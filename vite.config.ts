import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const ollamaHost = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const trainingHost = process.env.TRAINING_HOST ?? "http://127.0.0.1:8765";

const proxy = {
  "/api": {
    target: ollamaHost,
    changeOrigin: true,
  },
  "/training": {
    target: trainingHost,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/training/, "") || "/",
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    proxy,
  },
});
