// Crea un organizador y un rally de demostración con 3 checkpoints (Bogotá, centro histórico).
// Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed
import { config } from '../src/config.js';
import { one, closeDb } from '../src/db.js';
import { createOrganizer } from '../src/services/bootstrap.js';
import { createRally, createCheckpoint } from '../src/services/admin.js';

const email = config.adminEmail ?? 'organizador@cluekeeper.test';
const password = config.adminPassword ?? 'cambia-esta-clave';
const organizer = await createOrganizer(email, password, 'Organizador demo');

if (await one("SELECT 1 AS x FROM rallies WHERE code='DEMO01'")) {
  console.log('El rally DEMO01 ya existe.');
} else {
  const rally = await createRally(organizer.id, {
    name: 'Rally demo', code: 'DEMO01', durationMinutes: 90, wrongAttemptPenalty: 10, maxAttempts: 3, warningMinutes: [15, 5],
  });
  const common = { radius: 40, hideLocation: true, points: 100 };
  await createCheckpoint(rally.id, {
    ...common, title: 'Plaza de Bolívar', clueText: 'Busca la plaza donde se reúne el poder de la ciudad.',
    latitude: 4.5981, longitude: -74.0760, validationMethods: ['GEOFENCE', 'QR'],
    challenge: { type: 'QUESTION', title: 'Reto de observación', instruction: '¿Qué animal aparece en el edificio principal?', acceptedAnswers: ['condor', 'cóndor'] },
  });
  await createCheckpoint(rally.id, {
    ...common, title: 'Chorro de Quevedo', clueText: 'Donde nació la ciudad, un chorro de historia.',
    latitude: 4.5967, longitude: -74.0695, validationMethods: ['GEOFENCE'],
    challenge: { type: 'PHOTO', title: 'Evidencia fotográfica', instruction: 'Fotografía un detalle representativo del lugar.' },
  });
  await createCheckpoint(rally.id, {
    ...common, title: 'Museo del Oro', clueText: 'Un tesoro dorado te espera.',
    latitude: 4.6019, longitude: -74.0720, validationMethods: ['GEOFENCE'],
    challenge: { type: 'COMPASS', title: 'Orientación', instruction: 'Apunta hacia el cerro de Monserrate.', bearing: 90, tolerance: 25 },
  });
  console.log(`Rally demo creado. Código: DEMO01 · Organizador: ${email}`);
}

await closeDb();
