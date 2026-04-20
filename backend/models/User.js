const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  subscription: { type: String, enum: ['free', 'premium'], default: 'free' },
  searchHistory: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SearchHistory' }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
