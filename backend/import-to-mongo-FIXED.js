const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config({ path: './.env' });

// Data
const data = JSON.parse(fs.readFileSync('../lexph-data-clean.json', 'utf8'));

mongoose.connect(process.env.MONGODB_URI.replace('<db_password>', 'YOUR_MONGODB_PASSWORD'), {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('✅ MongoDB connected!');
  
  // Define schemas
  const CaseSchema = new mongoose.Schema({
    case_title: String, gr_number: String, date_decided: String, ponente: String,
    category: String, doctrine: String, facts: String, issue: String, ruling: String,
    tags: String, is_landmark: Number, is_active: Number
  });
  const Case = mongoose.model('Case', CaseSchema, 'cases');
  
  const LawSchema = new mongoose.Schema({
    title: String, article_number: String, content: String, category: String,
    source: String, ra_number: String, tags: String
  });
  const Law = mongoose.model('Law', LawSchema, 'laws');
  
  const DoctrineSchema = new mongoose.Schema({
    doctrine_name: String, description: String, legal_basis: String,
    related_cases: String, category: String, tags: String
  });
  const Doctrine = mongoose.model('Doctrine', DoctrineSchema, 'doctrines');
  
  const UserSchema = new mongoose.Schema({
    username: String, email: String, password_hash: String, full_name: String,
    role: String, subscription_status: String, trial_ends_at: String, is_active: Number
  });
  const User = mongoose.model('User', UserSchema, 'users');
  
  // Clear & import
  await Case.deleteMany({});
  await Law.deleteMany({});
  await Doctrine.deleteMany({});
  await User.deleteMany({});
  
  await Case.insertMany(data.cases);
  await Law.insertMany(data.laws);
  await Doctrine.insertMany(data.doctrines);
  await User.insertMany(data.users);
  
  console.log('✅ Import COMPLETE!');
  console.log(`📊 ${data.cases.length} cases, ${data.laws.length} laws, ${data.doctrines.length} doctrines, ${data.users.length} users imported`);
  
  mongoose.disconnect();
}).catch(console.error);

