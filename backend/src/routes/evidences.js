import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { parse, badRequest } from '../lib/errors.js';
import { authenticate, limiter } from '../middleware/index.js';
import { receiveEvidence, MAX_BYTES } from '../services/evidence.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES.AUDIO, files: 1, fields: 10 },
});

const fields = z.object({
  evidenceId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Identificador inválido'),
  checkpointId: z.string().min(1).max(64),
  type: z.enum(['PHOTO', 'AUDIO']),
  capturedAt: z.coerce.number().int().positive().optional(),
});

// Endpoint que consume frontend/src/services/evidenceSync.js
router.post(
  '/',
  authenticate(['team']),
  limiter({ limit: 60, key: (req) => req.team?.id ?? 'anon' }),
  upload.single('file'),
  (req, res) => {
    const data = parse(fields, req.body);
    const key = req.get('idempotency-key');
    if (key && key !== data.evidenceId) {
      throw badRequest('IDEMPOTENCY_MISMATCH', 'Idempotency-Key debe coincidir con evidenceId');
    }
    const { status, body } = receiveEvidence(req.rally, req.team, data, req.file);
    res.status(status).json(body);
  },
);

export default router;
