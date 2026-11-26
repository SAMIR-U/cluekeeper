// Genera un par de claves VAPID (P-256) para Web Push. No necesita dependencias.
// Uso: npm run vapid   → copia las dos líneas a las variables de entorno del servidor (Render).
// La clave privada no se guarda en ningún archivo: solo se imprime una vez.
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();

const pad32 = (buf) => (buf.length >= 32 ? buf : Buffer.concat([Buffer.alloc(32 - buf.length), buf])); // getPrivateKey puede omitir ceros a la izquierda
const publicKey = ecdh.getPublicKey().toString('base64url'); // 65 bytes, punto sin comprimir
const privateKey = pad32(ecdh.getPrivateKey()).toString('base64url'); // 32 bytes

console.log('Pega estas variables en el servidor (Render > Environment):\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:tu-correo@ejemplo.com\n');
console.log('Importante: la privada es secreta. Si la cambias, todas las suscripciones existentes dejan de funcionar.');
