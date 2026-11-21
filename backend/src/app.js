import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { errorHandler, notFoundHandler, originGuard, securityHeaders } from './middleware/index.js';
import authRoutes from './routes/auth.js';
import playRoutes from './routes/play.js';
import evidenceRoutes from './routes/evidences.js';
import eventRoutes from './routes/events.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin.replace(/\/$/, ''))),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'Last-Event-ID'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(originGuard);

  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/evidences', evidenceRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', playRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
