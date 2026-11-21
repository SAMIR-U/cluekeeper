import { config } from './config.js';
import { createApp } from './app.js';
import { bootstrapAdmin } from './services/bootstrap.js';
import { startTicker } from './services/ticker.js';

bootstrapAdmin();
const app = createApp();
startTicker();

const server = app.listen(config.port, () => {
  console.log(`ClueKeeper API escuchando en http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
