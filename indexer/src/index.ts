import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './api/routes.js';
import { startPolling } from './poller.js';
import { rateLimiter } from './api/rate-limit-middleware.js';
import { metricsMiddleware, handleMetrics } from './metrics.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Restrict CORS when ALLOWED_ORIGINS is set; otherwise allow all origins (dev default).
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
if (allowedOrigins.length === 0 && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: ALLOWED_ORIGINS is not set in production — CORS is fully open.');
}
app.use(
    cors(
        allowedOrigins.length > 0
            ? {
                  origin: (origin, cb) => {
                      // Allow server-to-server requests (no origin header) and listed origins.
                      if (!origin || allowedOrigins.includes(origin)) {
                          cb(null, true);
                      } else {
                          cb(new Error(`CORS: origin ${origin} not allowed`));
                      }
                  },
                  credentials: true,
              }
            : undefined // permissive when no allowlist is configured
    )
);
app.use(express.json());

// Track response time metrics for all routes
app.use(metricsMiddleware);

// Expose /metrics for Prometheus scrapers (bypass global rate limit)
app.get('/metrics', handleMetrics);

// Apply rate limiting to all other routes
app.use(rateLimiter);

// API Routes
app.use('/', routes);

// Health check
app.get('/health', (req: express.Request, res: express.Response) => {
    res.json({ status: 'ok' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Indexer API listening on http://localhost:${PORT}`);
    
    // Start the background polling loop
    startPolling().catch((err) => {
        console.error('Fatal error in poller:', err);
        process.exit(1);
    });
});
