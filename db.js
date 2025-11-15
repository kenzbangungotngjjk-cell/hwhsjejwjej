const { MongoClient } = require('mongodb');
const uri = "mongodb+srv://nigojbatakshumupa_db_user:AqfdCC9TrL1v6iVz@cluster0.qsainvs.mongodb.net/?appName=Cluster0";

const client = new MongoClient(uri);
let db;
async function connect() {
  if (!db) {
    await client.connect();
    db = client.db('pyhost');
  }
  return db;
}

async function insertLines(lines) {
  const d = await connect();
  const docs = lines.map(line => ({ line }));
  await d.collection('lines').insertMany(docs);
}

async function getLines(count) {
  const d = await connect();
  return d.collection('lines').find().limit(count).toArray();
}

async function deleteLines(ids) {
  const d = await connect();
  await d.collection('lines').deleteMany({ _id: { $in: ids } });
}

async function getUser(telegramId) {
  const d = await connect();
  return d.collection('users').findOne({ telegramId });
}

async function createUser(telegramId) {
  const d = await connect();
  const now = new Date();
  await d.collection('users').insertOne({ telegramId, premium: false, generatedToday: 0, lastGenerated: now });
}

async function incrementUserCount(telegramId, count) {
  const d = await connect();
  const now = new Date();
  const user = await getUser(telegramId);
  if (!user) return;
  if (!user.lastGenerated || user.lastGenerated.toDateString() !== now.toDateString()) {
    await d.collection('users').updateOne({ telegramId }, { $set: { generatedToday: count, lastGenerated: now } });
  } else {
    await d.collection('users').updateOne({ telegramId }, { $inc: { generatedToday: count }, $set: { lastGenerated: now } });
  }
}

async function isUserPremium(telegramId) {
  const user = await getUser(telegramId);
  return user && user.premium;
}

async function getUserGeneratedToday(telegramId) {
  const user = await getUser(telegramId);
  if (!user) return 0;
  const now = new Date();
  if (!user.lastGenerated || user.lastGenerated.toDateString() !== now.toDateString()) return 0;
  return user.generatedToday || 0;
}

async function promoteUserToPremium(telegramId) {
  const d = await connect();
  await d.collection('users').updateOne({ telegramId }, { $set: { premium: true } }, { upsert: true });
}

async function getAllUsers() {
  const d = await connect();
  return d.collection('users').find({}, { projection: { _id: 0 } }).toArray();
}

async function removeUser(telegramId) {
  const d = await connect();
  await d.collection('users').deleteOne({ telegramId });
}

async function getLinesCount() {
  const d = await connect();
  return d.collection('lines').countDocuments();
}

module.exports = {
  insertLines,
  getLines,
  deleteLines,
  getUser,
  createUser,
  incrementUserCount,
  isUserPremium,
  getUserGeneratedToday,
  promoteUserToPremium,
  getAllUsers,
  removeUser,
  getLinesCount
};
