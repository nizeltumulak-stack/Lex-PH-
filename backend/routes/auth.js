const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const router = express.Router();

// Mock users for dev (no Mongo)
const MOCK_USERS = [
  { _id: 'demo1', username: 'test', password: '$2a$10$N87WoilLY0sFngNnVjAvdeLFMYeDjGI84F5QXYthjGNCWqw.wiRXe', email: 'test@example.com', subscription: 'free' }, // bcrypt.hashSync('test', 10)
  { _id: 'demo2', username: 'admin', password: '$2a$10$dhEGp13fLBy5vxsaKjuUWuBV7rvmo7L1tvZqFt0KozBMXya8WjjFS', email: 'admin@lexph.com', subscription: 'premium' } // bcrypt.hashSync('adminpass', 10)
];

// Helper
function mockUser(username, password) {
  const user = MOCK_USERS.find(u => u.username === username);
  if (user && bcrypt.compareSync(password, user.password)) {
    return user;
  }
  return null;
}

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    // Mock if no Mongo
    if (mongoose.connection.readyState !== 1) {
      const mock = mockUser(username, password);
      if (mock) {
        const token = jwt.sign({ userId: mock._id }, process.env.JWT_SECRET || 'lexph_dev_secret');
        return res.json({ token, user: { id: mock._id, username: mock.username, subscription: mock.subscription } });
      }
      return res.status(401).json({ error: 'Invalid credentials (Demo: test/test or admin/adminpass)' });
    }

    // Real DB
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'lexph_dev_secret');
    res.json({ token, user: { id: user._id, username: user.username, subscription: user.subscription } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });

    // Mock mode - allow demo register
    if (mongoose.connection.readyState !== 1) {
      const token = jwt.sign({ userId: 'new' + Date.now(), username }, process.env.JWT_SECRET || 'lexph_dev_secret');
      res.status(201).json({ token, user: { id: 'newuser', username, email } });
      return;
    }

    // Real DB
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'lexph_dev_secret');
    res.status(201).json({ token, user: { id: user._id, username, email } });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
