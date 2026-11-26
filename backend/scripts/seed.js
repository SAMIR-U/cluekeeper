// Carga manual del Rally UPTC (en producción se hace solo al arrancar el servidor).
// Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed
import { config } from '../src/config.js';
import { closeDb } from '../src/db.js';
import { createOrganizer } from '../src/services/bootstrap.js';
import { ensurePresetRally } from '../src/services/seedRally.js';

const email = config.adminEmail ?? 'organizador@cluekeeper.test';
const password = config.adminPassword ?? 'cambia-esta-clave';
const organizer = await createOrganizer(email, password, 'Organizador');
const result = await ensurePresetRally(organizer.id);
console.log(`Rally UPTC26: ${result.action}${result.reason ? ` (${result.reason})` : ''} · organizador: ${email}`);
await closeDb();