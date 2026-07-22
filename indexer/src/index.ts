import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import routes from './api/routes.js';
import { startPolling } from './poller.js';
import { rateLimiter } from './api/rate-limit-middleware.js';
import { metricsMiddleware, handleMetrics } from './metrics.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Trust the first proxy in front of the app (e.g., Render, Heroku, AWS ELB).
// This is required for express-rate-limit to use the X-Forwarded-For header
// and correctly identify client IPs.
app.set('trust proxy', 1);

const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again after a minute.' },
});

app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean)
        : true,
    credentials: true,
}));
app.use(express.json());
app.use(limiter);

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
