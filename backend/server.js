const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

app.use(express.static('../'));

app.get('/', (req, res) => res.send('LexPH Backend - Ready!'));

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
