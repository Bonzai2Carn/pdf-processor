import { defineConfig } from 'vite'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const monacoEditorPlugin = require('vite-plugin-monaco-editor').default

export default defineConfig({
    root: path.resolve(__dirname, 'src'),
    server: {
        port: 5173,
        open: true
    },
    build: {
        outDir: path.resolve(__dirname, 'dist'),
        emptyOutDir: true
    },
    plugins: [
        monacoEditorPlugin({
            languageWorkers: ['editorWorkerService', 'html', 'css']
        })
    ]
})
