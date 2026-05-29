import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { metricsMiddleware, handleMetrics } from '../metrics';

// We can construct a minimal Express app to verify the middleware and handler
const app = express();
app.use(metricsMiddleware);
app.get('/metrics', handleMetrics);
app.get('/test', (req, res) => {
  res.status(200).json({ test: 'ok' });
});

describe('Prometheus Metrics API & Middleware', () => {
  it('exposes a valid /metrics endpoint', async () => {
    const res = await request(app)
      .get('/metrics')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('indexer_latest_ledger_processed');
    expect(res.text).toContain('indexer_network_latest_ledger');
    expect(res.text).toContain('indexer_sync_latency_ledgers');
    expect(res.text).toContain('http_request_duration_seconds');
  });

  it('records metrics for standard HTTP calls', async () => {
    // Send a request to a standard endpoint to trigger metrics collection
    await request(app)
      .get('/test')
      .expect(200);

    const res = await request(app)
      .get('/metrics')
      .expect(200);

    expect(res.text).toContain('method="GET"');
    expect(res.text).toContain('route="/test"');
    expect(res.text).toContain('status="200"');
  });
});
