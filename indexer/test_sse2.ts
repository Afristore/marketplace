import express from 'express';
import request from 'supertest';
import { logger } from './src/logger.js';

const app = express();
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    const interval = setInterval(() => res.write('data: hello\n\n'), 1000);
    req.on('close', () => clearInterval(interval));
});

async function run() {
    logger.info("Starting request");
    await new Promise<void>((resolve, reject) => {
        const req = request(app).get('/events');
        req.buffer(false);
        req.on('response', (res) => {
            logger.info("Got response", { status: res.status });
            res.on('error', () => {}); // Ignore abort error
            req.abort();
            resolve();
        });
        req.on('error', (err) => {
            if (err.message === 'aborted') return;
            reject(err);
        });
        req.end();
    });
    logger.info("Finished successfully");
}

run().catch((err) => logger.error('Request failed', { err }));
