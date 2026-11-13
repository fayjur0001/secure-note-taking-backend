/**
 * Creates the first admin account (public registration only creates "user"s).
 * Usage: npm run create-admin   (reads ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD from .env)
 */
const mongoose = require('mongoose');
const config = require('../src/config');
const User = require('../src/models/User');

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD');

  await mongoose.connect(config.mongoUri);
  const existing = await User.findOne({ email }); // { email: 1 } index
  if (existing) {
    existing.role = 'admin';
    await existing.save();
    console.log(`${email} already existed — role set to admin`);
  } else {
    await User.create({ name: process.env.ADMIN_NAME || 'Admin', email, password, role: 'admin' });
    console.log(`Admin created: ${email}`);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
