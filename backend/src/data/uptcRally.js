// Rally UPTC: Conoce la U — definición única del evento (campus central, Tunja).
// Fuente: documento del rally y "Ubicaciones.csv" (coordenadas oficiales de cada estación).
// El servidor la carga solo al arrancar (ver services/seedRally.js). Mientras el rally no haya
// iniciado, editar este archivo y volver a desplegar actualiza la base de datos.

const RADIUS_M = 45; // las estaciones 1 y 2 están a 55 m: con un radio mayor se validarían sin caminar
const POINTS = 150; // 8 estaciones x 150 = 1.200 puntos

export const UPTC_RALLY = {
  code: 'UPTC26',
  name: 'Rally UPTC: Conoce la U',
  durationMinutes: 120,
  wrongAttemptPenalty: 10, // puntos que se restan por cada intento fallido
  maxAttempts: 3, // tras 3 fallos el equipo avanza sin puntos
  warningMinutes: [15, 5],
  checkpoints: [
    {
      title: 'Plaza Camilo Torres Restrepo',
      clueText:
        'El recorrido empieza en la plaza que lleva el nombre de un protagonista de la Independencia. Busquen su placa o señal institucional.',
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
      clueText: 'Sigan hacia el lugar donde el campus guarda y comparte sus historias: la biblioteca central.',
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
        'Muy cerca del saber se encuentra un espacio ligado a la memoria muisca. Busquen el Templo de Goranchacha y observen sus señales desde el sendero público.',
      latitude: 5.548435,
      longitude: -73.356131,
      challenge: {
        type: 'PHOTO',
        title: 'Una puerta al conocimiento',
        instruction:
          'Fotografíen la señal o un detalle visible del templo desde el sendero. No ingresen ni pisen áreas arqueológicas.',
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
        'La siguiente huella está en un punto que la comunidad conoce como “El Muro”. Sigan la indicación de la organización hasta el muro o mural acordado.',
      latitude: 5.551862,
      longitude: -73.355614,
      // El reto pide escanear el QR de la estación. Para permitir también GPS: ['GEOFENCE', 'QR']
      validationMethods: ['QR'],
      challenge: {
        type: 'PHOTO',
        title: 'Una marca del campus',
        instruction:
          'Escaneen el QR de la estación y tomen una fotografía de un detalle del muro o mural, sin personas identificables.',
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
        'La última parada lleva el nombre de un educador boyacense. Localicen el edificio Rafael Azula y su señal de entrada.',
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