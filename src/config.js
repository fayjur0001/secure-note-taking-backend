require('dotenv').config({ quiet: true });

const config = {
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/secure_notes',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  bcryptRounds: 12,
  // comma-separated list, e.g. "https://my-notes.netlify.app,http://localhost:5173"; "*" allows any
  corsOrigins: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),
  // directory with the frontend's static files (set only in the Docker deploy)
  staticDir: process.env.STATIC_DIR || '',
};

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set it.');
}
if (config.corsOrigins.includes('*')) config.corsOrigins = '*';

module.exports = config;
