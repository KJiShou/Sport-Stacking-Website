import {dirname} from "node:path";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {vitePluginForArco} from "@arco-plugins/vite-react";
import react from "@vitejs/plugin-react";
import {defineConfig, loadEnv} from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ✅ 读取根目录的 .env 文件（不是 src/.env）
export default defineConfig(({mode}) => {
    // eslint-disable-next-line no-undef
    const env = loadEnv(mode, process.cwd()); // 👈 强制从项目根目录加载 .env
    const firebaseProjectId = env.VITE_FIREBASE_PROJECT_ID || "sport-stacking-website";
    const useFunctionsEmulator = env.VITE_USE_FUNCTIONS_EMULATOR === "true";

    return {
        plugins: [react(), vitePluginForArco({style: "css"})],
        server: {
            port: 5000,
            host: true,
            strictPort: true,
            open: true,
            cors: true,
            proxy: useFunctionsEmulator
                ? {
                      [`/${firebaseProjectId}`]: {
                          target: "http://127.0.0.1:5001",
                          changeOrigin: true,
                          secure: false,
                      },
                  }
                : undefined,
        },
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "src"),
            },
        },
        css: {
            preprocessorOptions: {
                less: {
                    javascriptEnabled: true,
                },
            },
        },
        build: {
            chunkSizeWarningLimit: 1000,
            outDir: "dist",
        },
        define: {
            // ✅ 将变量注入为全局变量，供代码中使用
            __VITE_GOOGLE_MAPS_API_KEY__: JSON.stringify(env.VITE_GOOGLE_MAPS_API_KEY),
        },
    };
});
