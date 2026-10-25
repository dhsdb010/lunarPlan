import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

import { cloudflare } from "@cloudflare/vite-plugin";

// dev-only: POST /__save?name=<file> stores test recordings in ../docs/media
const saveMedia = {
  name: 'save-media',
  configureServer(server: { middlewares: { use(fn: (req: any, res: any, next: () => void) => void): void } }) {
    server.middlewares.use((req, res, next) => {
      if (req.method !== 'POST' || !req.url?.startsWith('/__save')) return next();
      const name = new URL(req.url, 'http://x').searchParams.get('name') ?? 'recording.webm';
      if (!/^[\w.-]+$/.test(name)) { res.statusCode = 400; return res.end('bad name'); }
      const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => parts.push(c));
      req.on('end', () => { mkdirSync('../docs/media', { recursive: true }); writeFileSync(`../docs/media/${name}`, Buffer.concat(parts)); res.end('ok'); });
    });
  },
};
export default defineConfig({ plugins: [saveMedia, cloudflare()] });