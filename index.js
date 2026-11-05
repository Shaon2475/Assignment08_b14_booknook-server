require('dotenv').config();
const express = require('express'), cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const { jwtVerify } = require('jose');
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL?.split(',') || '*' }), express.json());
const client = new MongoClient(process.env.MONGODB_URI);
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
let books, borrows, reviews, favorites;
const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// JWT middleware: protects private routes
async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { payload } = await jwtVerify(token, secret);
    req.user = payload; next();
  } catch (e) { console.log('JWT error:', e.message); res.status(401).json({ message: 'Please log in to continue.' }); }
}

app.get('/', (_, res) => res.json({ ok: true, name: 'BookNook API' }));

// 1. all books (public) – supports ?limit=6, ?email=
app.get('/books', async (req, res) => {
  const q = req.query.email ? { userEmail: req.query.email } : {};
  const limit = Math.min(parseInt(req.query.limit) || 0, 100);
  res.json(await books.find(q).sort({ addedAt: -1 }).limit(limit).toArray());
});
