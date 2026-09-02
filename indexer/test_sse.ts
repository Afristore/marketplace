import express from 'express';
import request from 'supertest';

const app = express();
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    const interval = setInterval(() => res.write('data: hello\n\n'), 1000);
    req.on('close', () => clearInterval(interval));
});

async function run() {
    console.log("Starting request...");
    await new Promise<void>((resolve, reject) => {
        const req = request(app).get('/events');
        req.buffer(false); // <--- Add this!
        req.on('response', (res) => {
            console.log("Got response:", res.status);
            req.abort();
            resolve();
        });
        req.on('error', (err) => reject(err));
        req.end();
    });
    console.log("Finished successfully");
}

run().catch(console.error);
