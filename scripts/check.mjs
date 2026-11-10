import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
await server.ssrLoadModule('/scripts/check-scoring.ts');
await server.ssrLoadModule('/scripts/check-training.ts');
await server.close();
