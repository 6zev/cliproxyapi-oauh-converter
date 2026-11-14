import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 部署：
//  - 用户/组织主页仓库（<user>.github.io）→ base = '/'
//  - 普通仓库 → base = '/<repo>/'
//  CI 里由 .github/workflows/deploy.yml 传入 BASE_PATH；本地 dev 默认 '/'
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // 纯静态、无后端，产物直接丢到 Pages 即可
    outDir: 'dist',
    sourcemap: false,
  },
})
