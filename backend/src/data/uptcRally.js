// Rally UPTC: Conoce la U — definición única del evento (campus central, Tunja).
// Fuente: documento del rally y "Ubicaciones.csv" (coordenadas oficiales de cada estación).
// El servidor la carga solo al arrancar (ver services/seedRally.js). Mientras el rally no haya
// iniciado, editar este archivo y volver a desplegar actualiza la base de datos.

const RADIUS_M = 45; // las estaciones 1 y 2 están a 55 m: con un radio mayor se validarían sin caminar
const POINTS = 150; // 8 estaciones x 150 = 1.200 puntos

export const UPTC_RALLY = {
  code: 'UPTC26',
  name: 'Rally UPTC: Conoce la U',
  durationMinutes: 60,
  wrongAttemptPenalty: 10, // puntos que se restan por cada intento fallido
  maxAttempts: 3, // tras 3 fallos el equipo avanza sin puntos
  warningMinutes: [15, 5],
  checkpoints: [
    {
      title: 'Plaza Camilo Torres Restrepo',
      clueText:
        'El recorrido empieza en la plaza donde una figura con nombre propio vigila el corazón del campus',
      latitude: 5.552039,
      longitude: -73.35655,
      challenge: {
        type: 'QUESTION',
        title: 'Un nombre para recordar',
        instruction: '¿Cuál es el nombre completo que identifica esta plaza?',
        acceptedAnswers: ['Camilo Torres Restrepo', 'Plaza Camilo Torres Restrepo'],
      },
    },
    {
      title: 'Biblioteca Central Jorge Palacios Preciado',
      clueText: 'Sigan hacia el lugar donde el campus guarda y comparte sus historias. Y si vas a entrar ni comida ni bebida puedes llevar',
      latitude: 5.551555,
      longitude: -73.35663,
      challenge: {
        type: 'PHOTO',
        title: 'Huellas de conocimiento',
        instruction:
          'Tomen una fotografía de la señal de la biblioteca o de un detalle arquitectónico de su fachada. Eviten incluir rostros.',
      },
    },
    {
      title: 'Auditorio de Goranchacha',
      clueText:
        'Dirigansen al edificio donde estudian quienes ya se han graduado, y busca el salón de eventos cuyo nombre honra una raiz Muisca',
      latitude: 5.548435,
      longitude: -73.356131,
      challenge: {
        type: 'PHOTO',
        title: 'Una puerta al conocimiento',
        instruction:
          'Fotografíen la puerta de ingreso o si está abierto fotografíen el interior del auditorio',
      },
    },
    {
      title: 'Restaurante Estudiantil',
      clueText:
        'Busquen el espacio universitario que reúne a la comunidad alrededor de la comida. No necesitan comprar ni entrar.',
      latitude: 5.552028,
      longitude: -73.353927,
      challenge: {
        type: 'AUDIO',
        title: 'Un campus que suena',
        instruction:
          'Desde una zona común, graben cinco segundos de sonido ambiental. No registren conversaciones privadas.',
      },
    },
    {
      title: 'Museo de Historia Natural Luis Gonzalo Andrade',
      clueText:
        'En el sector de laboratorios está el museo que invita a conocer la biodiversidad. Si está cerrado, pueden completar la prueba desde la señal exterior.',
      latitude: 5.555421,
      longitude: -73.355429,
      challenge: {
        type: 'QUESTION',
        title: 'La vida que nos rodea',
        instruction: '¿Qué nombre propio completa el nombre oficial del Museo de Historia Natural de la UPTC?',
        acceptedAnswers: ['Luis Gonzalo Andrade', 'Museo de Historia Natural Luis Gonzalo Andrade'],
      },
    },
    {
      title: 'El Muro',
      clueText:
        'Encuentra el muro que no presume fama, pero guarda las voces de todos. Sube los escalones donde siempre hay conversación, aunque no haya escenario',
      latitude: 5.551862,
      longitude: -73.355614,
      challenge: {
        type: 'PHOTO',
        title: 'Una marca del campus',
        instruction:
          'Tomen una fotografía de un detalle del muro, sin personas identificables.',
      },
    },
    {
      title: 'Bienestar Universitario',
      clueText:
        'La ruta continúa en el lugar que acompaña la vida universitaria y el bienestar de la comunidad.',
      latitude: 5.551254,
      longitude: -73.354769,
      challenge: {
        type: 'AUDIO',
        title: 'Pausa de bienestar',
        instruction:
          'En un espacio permitido, graben cinco segundos de ambiente tranquilo. No graben conversaciones ni ingresen a las oficinas.',
      },
    },
    {
      title: 'Edificio Rafael Azula Barrera',
      clueText:
        'La última parada lleva el nombre de un educador boyacense. Localicen el edificio con una R y un monumento al frente.',
      latitude: 5.549775,
      longitude: -73.35688,
      challenge: {
        type: 'QUESTION',
        title: 'El último apellido',
        instruction: '¿Qué apellido aparece entre Rafael y Barrera?',
        acceptedAnswers: ['Azula', 'Rafael Azula Barrera', 'Azula Barrera'],
      },
    },
  ].map((cp) => ({
    radius: RADIUS_M,
    hideLocation: true, // el punto exacto no se revela: son retos de observación
    points: POINTS,
    validationMethods: ['GEOFENCE', 'QR'], // el QR sirve de respaldo cuando el GPS falla
    ...cp,
  })),
};
