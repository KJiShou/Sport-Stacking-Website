import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vitePluginForArco } from '@arco-plugins/vite-react';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        vitePluginForArco({
            style: 'css',
        }),
    ],
    root: 'src',
    server: {
        port: 5000, // Sets the server port to 5000
        host: true, // Allows access from outside the container
        strictPort: true, // Ensures the server fails if port 5000 is unavailable
        open: true, // Automatically opens the browser when the server starts
        cors: true, // Enables CORS support for external API calls
    },
    resolve: {
        alias: {
            '@': '/src', // Enables '@' as an alias for '/src' directory
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
    },
});
