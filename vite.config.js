import { defineConfig } from 'vite'
import path from 'path'

// Vite config - use `src` as root so index.html in src/ is the entry
export default defineConfig({
    root: path.resolve(__dirname, 'src'),
    server: {
        port: 5173,
        open: true
    },
    build: {
        outDir: path.resolve(__dirname, 'dist'),
        emptyOutDir: true
    }

})
