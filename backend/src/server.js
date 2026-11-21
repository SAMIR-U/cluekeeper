import { config } from './config.js';
import { closeDb } from './db.js';
import { createApp } from './app.js';
import { bootstrapAdmin } from './services/bootstrap.js';
import { startTicker } from './services/ticker.js';

await bootstrapAdmin();
const app = createApp();
startTicker();

const server = app.listen(config.port, () => {
  console.log(`ClueKeeper API escuchando en http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    server.closeAllConnections?.(); // cierra también los streams SSE abiertos
  });
}
