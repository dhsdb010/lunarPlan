import { defineConfig } from 'vite';
import { writeFileSync } from 'node:fs';

// dev-only: POST /__save?name=<file> writes the body to results/<file> (gate runs save their raw JSON)
const saveResults = {
  name: 'save-results',
  configureServer(server: { middlewares: { use(fn: (req: any, res: any, next: () => void) => void): void } }) {
    server.middlewares.use((req, res, next) => {
      if (req.method !== 'POST' || !req.url?.startsWith('/__save')) return next();
      const name = new URL(req.url, 'http://x').searchParams.get('name') ?? 'result.json';
      if (!/^[\w.-]+$/.test(name)) { res.statusCode = 400; return res.end('bad name'); }
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => { writeFileSync(`results/${name}`, body); res.end('ok'); });
    });
  },
};
export default defineConfig({
  plugins: [saveResults],
  build: { rollupOptions: { input: { index: 'index.html', babylon: 'babylon.html', three: 'three.html', gate: 'gate.html', horizon: 'horizon.html', gate2: 'gate2.html' } } },
});
