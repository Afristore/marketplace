import client from 'prom-client';
import express from 'express';

// Enable default metrics (CPU, memory, etc.)
client.collectDefaultMetrics();

// Custom Metrics
export const latestLedgerProcessedGauge = new client.Gauge({
  name: 'indexer_latest_ledger_processed',
  help: 'The sequence number of the latest ledger processed by the indexer',
});

export const networkLatestLedgerGauge = new client.Gauge({
  name: 'indexer_network_latest_ledger',
  help: 'The sequence number of the latest ledger on the Stellar network',
});

export const syncLatencyGauge = new client.Gauge({
  name: 'indexer_sync_latency_ledgers',
  help: 'The difference between the latest network ledger and the processed ledger',
});

export const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Middleware to track HTTP response times
export function metricsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const start = process.hrtime();
  
  res.on('finish', () => {
    const duration = process.hrtime(start);
    const durationInSeconds = duration[0] + duration[1] / 1e9;
    
    // Normalize route to avoid high-cardinality issues
    let route = req.baseUrl + (req.route ? req.route.path : req.path);
    if (!route || route === '') {
      route = req.path;
    }
    
    httpRequestDurationMicroseconds.labels(
      req.method,
      route,
      res.statusCode.toString()
    ).observe(durationInSeconds);
  });
  
  next();
}

// Expose metrics handler
export async function handleMetrics(req: express.Request, res: express.Response) {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
}
