import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, run } from '../db.js';
import { config } from '../config.js';

// Crea el organizador inicial desde ADMIN_EMAIL / ADMIN_PASSWORD (no hay registro público de organizadores)
export function createOrganizer(email, password, name = null) {
  const existing = one('SELECT * FROM organizers WHERE email=?', email.toLowerCase());
  if (existing) return existing;
  const id = randomUUID();
  run(
    'INSERT INTO organizers (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)',
    id, email.toLowerCase(), bcrypt.hashSync(password, 10), name, Date.now(),
  );
  return one('SELECT * FROM organizers WHERE id=?', id);
}

export function bootstrapAdmin() {
  if (config.adminEmail && config.adminPassword) {
    if (config.adminPassword.length < 8) throw new Error('ADMIN_PASSWORD debe tener al menos 8 caracteres');
    createOrganizer(config.adminEmail, config.adminPassword, 'Organizador');
  }
}
