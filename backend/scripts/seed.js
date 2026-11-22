// Crea un organizador y rallies demo de Bogotá y UPTC Tunja.
// Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed
import { config } from '../src/config.js';
import { one, all, run, closeDb } from '../src/db.js';
import { createOrganizer } from '../src/services/bootstrap.js';
import { createRally, createCheckpoint, updateCheckpoint } from '../src/services/admin.js';

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

let uptc = await one("SELECT * FROM rallies WHERE code='UPTC26'");
if (uptc && uptc.status !== 'NOT_STARTED') {
  console.log('UPTC26 ya está en curso o finalizado; no se modificó para preservar sus resultados.');
} else if (uptc && (await one('SELECT COUNT(*) AS n FROM progress WHERE team_id IN (SELECT id FROM teams WHERE rally_id=?)', uptc.id)).n > 0) {
  console.log('UPTC26 ya tiene progreso registrado; no se modificó para preservar esos resultados.');
} else {
  if (!uptc) uptc = await createRally(organizer.id, {
    name: 'La ruta del guardián UPTC', code: 'UPTC26', durationMinutes: 120,
    wrongAttemptPenalty: 10, maxAttempts: 3, warningMinutes: [15, 5],
  });
  else await run("UPDATE rallies SET name=?, duration_minutes=120, wrong_attempt_penalty=10, max_attempts=3, warning_minutes='15,5' WHERE id=?", 'La ruta del guardián UPTC', uptc.id);
  const common = { radius: 90, hideLocation: true, points: 150, validationMethods: ['GEOFENCE', 'QR'] };
  const checkpoints = [
    {
      title: 'Plaza Camilo Torres', clueText: 'El recorrido empieza en la plaza que lleva el nombre de un protagonista de la Independencia. Busca su placa o señal institucional.',
      latitude: 5.55192, longitude: -73.35692,
      challenge: { type: 'QUESTION', title: 'Un nombre para recordar', description: 'Observa la señal de la plaza.', instruction: '¿Cuál es el nombre completo que identifica esta plaza?', acceptedAnswers: ['camilo torres restrepo', 'plaza camilo torres restrepo', 'camilo torres'] },
    },
    {
      title: 'Biblioteca Central Jorge Palacios', clueText: 'Ahora ve al lugar donde el campus guarda y comparte sus historias: busca la biblioteca central.',
      latitude: 5.55140, longitude: -73.35665,
      challenge: { type: 'PHOTO', title: 'Huellas de conocimiento', description: 'La fachada también cuenta una historia.', instruction: 'Toma una foto de la señal o de un detalle arquitectónico de la biblioteca. Evita incluir rostros.' },
    },
    {
      title: 'Templo de Goranchacha', clueText: 'Muy cerca del saber se encuentra un espacio ligado a la memoria muisca. Busca el Templo de Goranchacha y observa sus señales desde el sendero público.',
      latitude: 5.55235, longitude: -73.35742,
      challenge: { type: 'PHOTO', title: 'Memoria muisca', description: 'Una huella cultural forma parte de la historia del campus.', instruction: 'Fotografía la señal o un detalle visible del Templo de Goranchacha desde el sendero. No ingreses ni pises áreas arqueológicas.' },
    },
    {
      title: 'Restaurante Estudiantil', clueText: 'Sigue hacia el espacio universitario que reúne a la comunidad alrededor de la comida. No necesitas comprar ni entrar.',
      latitude: 5.55290, longitude: -73.35495,
      challenge: { type: 'AUDIO', title: 'Un campus que suena', description: 'Escucha el ambiente desde una zona común.', instruction: 'Graba cinco segundos de sonido ambiental, sin registrar conversaciones privadas.' },
    },
    {
      title: 'Museo de Historia Natural Luis Gonzalo Andrade', clueText: 'Busca el museo del sector de laboratorios que invita a conocer la biodiversidad. Si está cerrado, completa la prueba desde su señal exterior.',
      latitude: 5.55545, longitude: -73.35375,
      challenge: { type: 'QUESTION', title: 'La vida que nos rodea', description: 'Lee el nombre en la señal del museo.', instruction: '¿Qué nombre propio completa el nombre oficial del Museo de Historia Natural de la UPTC?', acceptedAnswers: ['luis gonzalo andrade', 'museo de historia natural luis gonzalo andrade', 'luis andrade'] },
    },
    {
      title: 'El Muro', clueText: 'El siguiente punto es conocido por la comunidad como “El Muro”. Sigue la indicación del organizador hasta el muro o mural acordado.',
      latitude: 5.55220, longitude: -73.35580, validationMethods: ['QR'],
      challenge: { type: 'PHOTO', title: 'Una marca del campus', description: 'El equipo organizador debe colocar el QR en el punto acordado.', instruction: 'Toma una foto de un detalle del mural o muro, sin personas identificables.' },
    },
    {
      title: 'Bienestar Universitario', clueText: 'La ruta continúa en el lugar que acompaña la vida universitaria y el bienestar de la comunidad.',
      latitude: 5.55305, longitude: -73.35555,
      challenge: { type: 'AUDIO', title: 'Pausa de bienestar', description: 'Detente en un espacio permitido y escucha el campus.', instruction: 'Graba cinco segundos de ambiente tranquilo. No grabes conversaciones ni ingreses a oficinas.' },
    },
    {
      title: 'Edificio Rafael Azula Barrera', clueText: 'La última parada lleva el nombre de un educador boyacense. Localiza el edificio Rafael Azula y su señal de entrada.',
      latitude: 5.54967, longitude: -73.35689,
      challenge: { type: 'QUESTION', title: 'El último apellido', description: 'Lee el nombre completo en la fachada o señal.', instruction: '¿Qué apellido aparece entre Rafael y Barrera?', acceptedAnswers: ['azula', 'rafael azula barrera', 'azula barrera'] },
    },
  ];
  const existingCheckpoints = await all('SELECT id FROM checkpoints WHERE rally_id=? ORDER BY position', uptc.id);
  for (const [index, checkpoint] of checkpoints.entries()) {
    const input = { ...common, ...checkpoint };
    if (existingCheckpoints[index]) await updateCheckpoint(uptc.id, existingCheckpoints[index].id, input);
    else await createCheckpoint(uptc.id, input);
  }
  for (const surplus of existingCheckpoints.slice(checkpoints.length)) await run('DELETE FROM checkpoints WHERE id=?', surplus.id);
  console.log('Rally UPTC actualizado. Código: UPTC26 · 8 checkpoints');
}

await closeDb();
