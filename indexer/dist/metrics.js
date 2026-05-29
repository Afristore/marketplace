"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpRequestDurationMicroseconds = exports.syncLatencyGauge = exports.networkLatestLedgerGauge = exports.latestLedgerProcessedGauge = void 0;
exports.metricsMiddleware = metricsMiddleware;
exports.handleMetrics = handleMetrics;
const prom_client_1 = __importDefault(require("prom-client"));
// Enable default metrics (CPU, memory, etc.)
prom_client_1.default.collectDefaultMetrics();
// Custom Metrics
exports.latestLedgerProcessedGauge = new prom_client_1.default.Gauge({
    name: 'indexer_latest_ledger_processed',
    help: 'The sequence number of the latest ledger processed by the indexer',
});
exports.networkLatestLedgerGauge = new prom_client_1.default.Gauge({
    name: 'indexer_network_latest_ledger',
    help: 'The sequence number of the latest ledger on the Stellar network',
});
exports.syncLatencyGauge = new prom_client_1.default.Gauge({
    name: 'indexer_sync_latency_ledgers',
    help: 'The difference between the latest network ledger and the processed ledger',
});
exports.httpRequestDurationMicroseconds = new prom_client_1.default.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
// Middleware to track HTTP response times
function metricsMiddleware(req, res, next) {
    const start = process.hrtime();
    res.on('finish', () => {
        const duration = process.hrtime(start);
        const durationInSeconds = duration[0] + duration[1] / 1e9;
        // Normalize route to avoid high-cardinality issues
        let route = req.baseUrl + (req.route ? req.route.path : req.path);
        if (!route || route === '') {
            route = req.path;
        }
        exports.httpRequestDurationMicroseconds.labels(req.method, route, res.statusCode.toString()).observe(durationInSeconds);
    });
    next();
}
// Expose metrics handler
async function handleMetrics(req, res) {
    try {
        res.set('Content-Type', prom_client_1.default.register.contentType);
        res.end(await prom_client_1.default.register.metrics());
    }
    catch (err) {
        res.status(500).end(err);
    }
}
