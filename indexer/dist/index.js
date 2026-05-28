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
const rate_limit_middleware_js_1 = require("./api/rate-limit-middleware.js");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Apply rate limiting to all routes
app.use(rate_limit_middleware_js_1.rateLimiter);
// API Routes
app.use('/', routes_js_1.default);
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
