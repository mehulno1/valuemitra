import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// react-remove-scroll@2.7.x uses extensionless ESM imports (e.g. `import './medium'`)
// that Rollup 4 cannot resolve. Alias to the ES5/CJS entry which uses require() instead.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@valuemitra/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      'react-remove-scroll': path.resolve(__dirname, '../../node_modules/react-remove-scroll/dist/es5/index.js'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3006',
        changeOrigin: true,
      },
    },
  },
});
