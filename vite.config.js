import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {vitePluginForArco} from "@arco-plugins/vite-react";
import {fileURLToPath} from "url";
import {dirname} from "path";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        vitePluginForArco({
            style: "css",
        }),
    ],
    root: "src",
    server: {
        port: 5000, // Sets the server port to 5000
        host: true, // Allows access from outside the container
        strictPort: true, // Ensures the server fails if port 5000 is unavailable
        open: true, // Automatically opens the browser when the server starts
        cors: true, // Enables CORS support for external API calls
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    css: {
        preprocessorOptions: {
            less: {
                javascriptEnabled: true, // Required for customizing Arco themes with LESS
            },
        },
    },
    build: {
        chunkSizeWarningLimit: 1000, // Increase chunk size limit to avoid warnings for large bundles
        outDir: "dist",
    },
});
