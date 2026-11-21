// Crea un organizador y rallies demo de Bogotá y UPTC Tunja.
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

if (await one("SELECT 1 AS x FROM rallies WHERE code='UPTC26'")) {
  console.log('El rally UPTC26 ya existe.');
} else {
  const rally = await createRally(organizer.id, {
    name: 'La ruta del guardián UPTC', code: 'UPTC26', durationMinutes: 120,
    wrongAttemptPenalty: 10, maxAttempts: 3, warningMinutes: [15, 5],
  });
  const common = { radius: 35, hideLocation: true, points: 150, validationMethods: ['GEOFENCE', 'QR'] };
  await createCheckpoint(rally.id, {
    ...common, title: 'Plaza Camilo Torres', clueText: 'Encuentra la plaza central que lleva el nombre del prócer y observa el símbolo que corona el espacio.',
    latitude: 5.55192, longitude: -73.35692,
    challenge: { type: 'QUESTION', title: 'El símbolo de la plaza', description: 'Rally de bienvenida al campus UPTC.', instruction: '¿Qué figura o símbolo principal reconoces en el centro de la plaza?', acceptedAnswers: ['camilo torres', 'busto de camilo torres', 'monumento a camilo torres', 'busto'] },
  });
  await createCheckpoint(rally.id, {
    ...common, title: 'Biblioteca Central Jorge Palacios', clueText: 'Sigue hacia el edificio donde se guardan las historias y el conocimiento del campus.',
    latitude: 5.55140, longitude: -73.35665,
    challenge: { type: 'PHOTO', title: 'Rastros de conocimiento', description: 'Busca un detalle arquitectónico visible desde el exterior.', instruction: 'Toma una fotografía de un detalle de la fachada o de la señalización de la Biblioteca Central.' },
  });
  await createCheckpoint(rally.id, {
    ...common, title: 'Bohío y Templo de Goranchacha', clueText: 'Entre árboles y memoria ancestral, busca el espacio que evoca el legado muisca en la UPTC.',
    latitude: 5.55235, longitude: -73.35742,
    challenge: { type: 'AUDIO', title: 'Paisaje sonoro del campus', description: 'Detente un momento y escucha el entorno.', instruction: 'Graba cinco segundos de sonido ambiental junto al Bohío, sin incluir conversaciones privadas.' },
  });
  await createCheckpoint(rally.id, {
    ...common, title: 'Jardín Botánico UPTC', clueText: 'La última pista te lleva a un refugio verde de biodiversidad dentro del campus.',
    latitude: 5.55285, longitude: -73.35805,
    challenge: { type: 'COMPASS', title: 'El rumbo del guardián', description: 'Cierra la ruta en el Jardín Botánico.', instruction: 'Usa la brújula para apuntar hacia el norte y captura el rumbo.', bearing: 0, tolerance: 35 },
  });
  console.log(`Rally UPTC creado. Código: UPTC26 · 4 checkpoints`);
}

await closeDb();
