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

console.log('Mongo URI:', process.env.MONGODB_URI ? 'Set in .env (Atlas?)' : 'Default localhost');
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lex_ph')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
