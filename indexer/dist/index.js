"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const routes_js_1 = __importDefault(require("./api/routes.js"));
const poller_js_1 = require("./poller.js");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const prom_client_1 = require("prom-client");
// API Routes
app.use('/', routes_js_1.default);
// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', prom_client_1.register.contentType);
        res.end(await prom_client_1.register.metrics());
    }
    catch (ex) {
        res.status(500).end(ex);
    }
});
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});
// Start the server
app.listen(PORT, () => {
    console.log(`Indexer API listening on http://localhost:${PORT}`);
    // Start the background polling loop
    (0, poller_js_1.startPolling)().catch((err) => {
        console.error('Fatal error in poller:', err);
        process.exit(1);
    });
});
