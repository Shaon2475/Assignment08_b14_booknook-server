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

// 2. one book
app.get('/books/:id', auth, async (req, res) => {
  const _id = oid(req.params.id);
  const book = _id && await books.findOne({ _id });
  book ? res.json(book) : res.status(404).json({ message: 'Book not found.' });
});
// 3. add book
app.post('/books', auth, async (req, res) => {
  const { title, author, category, image, description, totalCopies } = req.body;
  if (!title || !author || !category || !image) return res.status(400).json({ message: 'Please fill in all required fields.' });
  const copies = Math.max(parseInt(totalCopies) || 1, 1);
  const doc = { title, author, category, image, description, totalCopies: copies, copies,
    userName: req.user.name, userEmail: req.user.email, addedAt: new Date() };
  const r = await books.insertOne(doc);
  res.status(201).json({ ...doc, _id: r.insertedId });
});

// 4. update book (owner only, copies can be changed)
app.patch('/books/:id', auth, async (req, res) => {
  const _id = oid(req.params.id);
  const { title, author, category, image, description, totalCopies } = req.body;
  const book = _id && await books.findOne({ _id, userEmail: req.user.email });
  if (!book) return res.status(403).json({ message: 'You can only edit your own books.' });
  const total = Math.max(parseInt(totalCopies) || book.totalCopies, 1);
  const borrowed = book.totalCopies - book.copies;
  if (total < borrowed) return res.status(400).json({ message: `${borrowed} copies are borrowed right now, so total cannot be less than that.` });
  await books.updateOne({ _id }, { $set: { title, author, category, image, description, totalCopies: total, copies: total - borrowed } });
  res.json({ updated: true });
});
// 5. delete book (owner only)
app.delete('/books/:id', auth, async (req, res) => {
  const _id = oid(req.params.id);
  const r = await books.deleteOne({ _id, userEmail: req.user.email });
  if (!r.deletedCount) return res.status(403).json({ message: 'You can only delete your own books.' });
  await borrows.deleteMany({ bookId: req.params.id });
  await favorites.deleteMany({ bookId: req.params.id });
  res.json({ deleted: true });
});
