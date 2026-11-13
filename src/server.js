const mongoose = require('mongoose');
const config = require('./config');
const app = require('./app');

async function start(mongoUri = config.mongoUri) {
  await mongoose.connect(mongoUri);
  console.log('MongoDB connected');
  const server = app.listen(config.port, () => console.log(`Server listening on http://localhost:${config.port}`));
  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { start };
