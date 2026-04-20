const mongoose = require('mongoose');

const searchHistorySchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false, // Anonymous searches allowed
    index: true
  },
  query: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
    index: true // Fast lookup
  },
  category: {
    type: String,
    enum: ['general', 'labor', 'civil', 'criminal', 'constitutional', 'commercial'],
    default: 'general'
  },
  results: [{
    title: String,
    url: String,
    source: String,
    snippet: String,
    relevance_score: Number
  }],
  analysis: {
    conclusion: String,
    supporting_cases: [Object],
    relevant_laws: [Object],
    confidence: String,
    next_steps: [String]
  },
  sources: [String],
  results_count: {
    type: Number,
    default: 0,
    min: 0
  },
  duration_ms: {
    type: Number,
    min: 0
  },
  ip_address: {
    type: String,
    index: true // Rate limiting/security
  },
  is_cached: {
    type: Boolean,
    default: false
  },
  cache_expires_at: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for fast queries
searchHistorySchema.index({ user_id: 1, createdAt: -1 });
searchHistorySchema.index({ query: 'text' }); // Text search
searchHistorySchema.index({ 'cache_expires_at': 1 }, { expireAfterSeconds: 0 }); // TTL

// Virtual for recent count
searchHistorySchema.virtual('is_recent').get(function() {
  return this.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000);
});

const SearchHistory = mongoose.models.SearchHistory || mongoose.model('SearchHistory', searchHistorySchema);

module.exports = SearchHistory;

