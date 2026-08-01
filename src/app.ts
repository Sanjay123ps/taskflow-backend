import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { generalRateLimiter } from './middleware/rateLimit.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { sendSuccess } from './utils/apiResponse';
import apiRoutes from './routes/index';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct req.ip

  app.use(helmet());
  app.use(compression());

  // Only the deployed Vercel Admin/Staff frontends (and local dev) may call
  // this API with credentials. Never falls back to a wildcard origin.
  const allowedOrigins = [env.FRONTEND_ADMIN_URL, env.FRONTEND_STAFF_URL].filter(
    (origin): origin is string => Boolean(origin),
  );

  // Local Vite dev servers aren't in FRONTEND_ADMIN_URL / FRONTEND_STAFF_URL
  // (those point at production). Without this, every preflight from
  // localhost fails CORS and looks like "server unreachable" in the browser.
  if (env.NODE_ENV !== 'production') {
    // 5173 = Admin dev server, 5174 = Staff dev server (see staff/vite.config.ts).
    allowedOrigins.push('http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000');
  }

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          // Reject, don't throw: throwing here makes Express return a 500
          // on the OPTIONS preflight with no CORS headers, which the
          // browser reports as a network/connection failure rather than
          // a clear "origin not allowed" response.
          logger.warn({ origin }, 'Blocked request from disallowed CORS origin');
          callback(null, false);
        }
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  app.use('/api', generalRateLimiter);

  app.get('/health', (_req, res) => {
    sendSuccess(res, null, 'Backend is healthy');
  });

  app.use('/api/v1', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
