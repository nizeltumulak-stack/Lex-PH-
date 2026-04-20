const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const rawData = JSON.parse(fs.readFileSync('../lex_ph.json', 'utf8'));
const data = {
  cases: rawData[0]?.data || [],
  laws: rawData[3]?.data || [],
  doctrines: rawData[1]?.data || [],
  users: rawData[4]?.data || [],
  categories: rawData[2]?.data || []
};

// MongoDB Schemas
const caseSchema = new mongoose.Schema({
  case_title: String, gr_number: String, date_decided: String, ponente: String,
  category: String, doctrine: String, facts: String, issue: String,
  ruling: String, tags: String, is_landmark: {type: Number, default: 0},
  is_active: {type: Number, default: 1}
});

const lawSchema = new mongoose.Schema({
  title: String, article_number: String, content: String, category: String,
  source: String, ra_number: String, tags: String, is_active: {type: Number, default: 1}
});

const doctrineSchema = new mongoose.Schema({
  doctrine_name: String, description: String, legal_basis: String,
  related_cases: String, category: String, tags: String
});

const userSchema = new mongoose.Schema({
  username: String, email: String, password_hash: String, full_name: String,
  role: String, subscription_status: String, trial_ends_at: String
});

const Case = mongoose.models.Case || mongoose.model('Case', caseSchema);
const Law = mongoose.models.Law || mongoose.model('Law', lawSchema);
const Doctrine = mongoose.models.Doctrine || mongoose.model('Doctrine', doctrineSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lex_ph');
    console.log('✅ Connected to MongoDB');
    
    // Clear existing data
    await Case.deleteMany({}); 
    await Law.deleteMany({});
    await Doctrine.deleteMany({});
    await User.deleteMany({});
    
    // Insert new data
    await Case.insertMany(data.cases.map(c => ({...c, id: undefined})));
    await Law.insertMany(data.laws.map(l => ({...l, id: undefined})));
    await Doctrine.insertMany(data.doctrines.map(d => ({...d, id: undefined})));
    await User.insertMany(data.users.map(u => ({...u, id: undefined})));
    
    console.log(`✅ Migration complete!`);
    console.log(`📊 ${data.cases.length} cases, ${data.laws.length} laws, ${data.doctrines.length} doctrines, ${data.users.length} users`);
    
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    mongoose.connection.close();
  }
}

migrate();
