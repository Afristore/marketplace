import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './api/routes.js';
import { startPolling } from './poller.js';
import { rateLimiter } from './api/rate-limit-middleware.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Apply rate limiting to all routes
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
