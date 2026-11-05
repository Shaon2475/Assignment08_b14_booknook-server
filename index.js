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
const ready = client.connect().then(() => {
  const db = client.db('booknook');
  books = db.collection('books'); borrows = db.collection('borrows'); reviews = db.collection('reviews'); favorites = db.collection('favorites');
});
app.use(async (req, res, next) => {
  try { await ready; next(); } catch (e) { res.status(500).json({ message: 'Database connection failed.' }); }
});

// JWT middleware: protects private routes
async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { payload } = await jwtVerify(token, secret);
    req.user = payload; next();
  } catch (e) { console.log('JWT error:', e.message); res.status(401).json({ message: 'Please log in to continue.' }); }
}

app.get('/', (_, res) => res.json({ ok: true, name: 'BookNook API' }));

app.get('/books', async (req, res) => {
  const q = req.query.email ? { userEmail: req.query.email } : {};
  const limit = Math.min(parseInt(req.query.limit) || 0, 100);
  res.json(await books.find(q).sort({ addedAt: -1 }).limit(limit).toArray());
});
app.get('/books/:id', auth, async (req, res) => {
  const _id = oid(req.params.id);
  const book = _id && await books.findOne({ _id });
  book ? res.json(book) : res.status(404).json({ message: 'Book not found.' });
});
app.post('/books', auth, async (req, res) => {
  const { title, author, category, image, description, totalCopies } = req.body;
  if (!title || !author || !category || !image) return res.status(400).json({ message: 'Please fill in all required fields.' });
  const copies = Math.max(parseInt(totalCopies) || 1, 1);
  const doc = { title, author, category, image, description, totalCopies: copies, copies,
    userName: req.user.name, userEmail: req.user.email, addedAt: new Date() };
  const r = await books.insertOne(doc);
  res.status(201).json({ ...doc, _id: r.insertedId });
});
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
app.delete('/books/:id', auth, async (req, res) => {
  const _id = oid(req.params.id);
  const r = await books.deleteOne({ _id, userEmail: req.user.email });
  if (!r.deletedCount) return res.status(403).json({ message: 'You can only delete your own books.' });
  await borrows.deleteMany({ bookId: req.params.id });
  await favorites.deleteMany({ bookId: req.params.id });
  res.json({ deleted: true });
});
app.post('/borrows', auth, async (req, res) => {
  const { bookId, days = 7 } = req.body;
  const _id = oid(bookId);
  const book = _id && await books.findOne({ _id });
  if (!book) return res.status(404).json({ message: 'Book not found.' });
  if (await borrows.findOne({ bookId, userEmail: req.user.email }))
    return res.status(409).json({ message: 'You have already borrowed this book.' });
  const dec = await books.updateOne({ _id, copies: { $gt: 0 } }, { $inc: { copies: -1 } });
  if (!dec.modifiedCount) return res.status(409).json({ message: 'No copies available right now.' });
  const borrowDate = new Date(), returnDate = new Date(Date.now() + Math.min(+days || 7, 30) * 864e5);
  const doc = { bookId, bookTitle: book.title, bookImage: book.image, userEmail: req.user.email, borrowDate, returnDate };
  const r = await borrows.insertOne(doc);
  res.status(201).json({ ...doc, _id: r.insertedId });
});
app.get('/borrows', auth, async (req, res) =>
  res.json(await borrows.find({ userEmail: req.user.email }).sort({ borrowDate: -1 }).toArray()));

app.delete('/borrows/:id', auth, async (req, res) => {
  const _id = oid(req.params.id);
  const b = _id && await borrows.findOneAndDelete({ _id, userEmail: req.user.email });
  if (!b) return res.status(404).json({ message: 'Borrow record not found.' });
  await books.updateOne({ _id: oid(b.bookId) }, { $inc: { copies: 1 } });
  res.json({ returned: true });
});

app.get('/reviews', async (_, res) => res.json(await reviews.find().sort({ createdAt: -1 }).limit(12).toArray()));
app.post('/reviews', auth, async (req, res) => {
  const text = (req.body.text || '').trim();
  const rating = Math.min(Math.max(parseInt(req.body.rating) || 5, 1), 5);
  if (text.length < 5 || text.length > 300) return res.status(400).json({ message: 'Review must be 5 to 300 characters long.' });
  const doc = { userName: req.user.name, userEmail: req.user.email, text, rating, createdAt: new Date() };
  const r = await reviews.insertOne(doc);
  res.status(201).json({ ...doc, _id: r.insertedId });
});
app.get('/favorites', auth, async (req, res) => {
  const favs = await favorites.find({ userEmail: req.user.email }).toArray();
  const ids = favs.map((f) => oid(f.bookId)).filter(Boolean);
  res.json(await books.find({ _id: { $in: ids } }).toArray());
});
app.post('/favorites/:bookId', auth, async (req, res) => {
  const q = { userEmail: req.user.email, bookId: req.params.bookId };
  if (await favorites.findOne(q)) { await favorites.deleteOne(q); return res.json({ favorite: false }); }
  await favorites.insertOne({ ...q, createdAt: new Date() });
  res.json({ favorite: true });
});
if (!process.env.VERCEL) app.listen(process.env.PORT || 5000, () => console.log('BookNook API running'));
module.exports = app;
