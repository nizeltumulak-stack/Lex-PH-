const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const ALLOWED_ORIGINS = [
  'https://lex-ph.netlify.app',
  'https://lex-ph-backend.onrender.com',
  'http://localhost:3000',
  'http://localhost:5000',
];

const corsOptions = {
  origin: (origin, callback) => {
    const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin?.includes('localhost');
    callback(null, isAllowed || ALLOWED_ORIGINS[0]);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());

// Auth Routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Static files
app.use(express.static('../'));

// Home route
app.get('/', (req, res) => res.send('LexPH Backend - Ready!'));

// ✅ AI Search Route
app.post('/api/analyze', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'No query provided' });
    }

    const { analyzeLexph } = require('../lexph-cli/lexphService');
    const result = await analyzeLexph(query);
    res.json({ result });

  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// MongoDB Connection
let mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/lex_ph';
if (mongoUri.includes('<db_password>')) {
  console.log('MongoDB URI contains placeholder; falling back to localhost');
  mongoUri = 'mongodb://localhost:27017/lex_ph';
}

console.log('Mongo URI:', mongoUri.includes('localhost') ? 'Localhost' : 'Atlas');

mongoose.connect(mongoUri)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));

// Redeployed: 2026-04-30 17:07:52
