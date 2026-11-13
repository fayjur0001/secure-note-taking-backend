const express = require('express');
const cors = require('cors');
const config = require('./config');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.disable('x-powered-by');
// Frontend is deployed separately (Netlify/Vercel), so allow its origin.
// We use Bearer tokens (not cookies), so credentials are not needed.
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '100kb' }));

app.get('/', (_req, res) => res.json({ name: 'secure-notes-api', status: 'ok' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
