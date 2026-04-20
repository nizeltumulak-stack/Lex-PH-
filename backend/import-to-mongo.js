const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config({ path: './.env' });

// Data
const data = JSON.parse(fs.readFileSync('../lexph-data-clean.json', 'utf8'));

// Connect
process.env.MONGODB_URI || 'mongodb://localhost:27017/lexph', {\n  useNewUrlParser: true,\n  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected!'));

// Schemas matching backend/server.js
const schemas = {
  User: {
    username: String, email: String, passwordHash: String, full_name: String,
    role: String, subscriptionStatus: String, trialEndsAt: String, isActive: Boolean
  },
  Case: {
    case_title: String, gr_number: String, date_decided: String, ponente: String,
    category: String, doctrine: String, facts: String, issue: String, ruling: String,
    tags: String, is_landmark: Number, is_active: Number
  },
  Law: {
    title: String, article_number: String, content: String, category: String,
    source: String, ra_number: String, tags: String
  },
  Doctrine: {
    doctrine_name: String, description: String, legal_basis: String,
    related_cases: String, category: String, tags: String
  }
};

Object.entries(schemas).forEach(([name, schema]) => {
  mongoose.model(name, new mongoose.Schema(schema));
});

async function importData() {
  const db = mongoose.connection.db;
  
  // Clear collections
  await Promise.all(Object.keys(schemas).map(name => 
    mongoose.model(name).deleteMany({})
  ));
  
  // Import
  await mongoose.model('Case').insertMany(data.cases);
  await mongoose.model('Law').insertMany(data.laws);
  await mongoose.model('Doctrine').insertMany(data.doctrines);
  await mongoose.model('User').insertMany(data.users);
  
  console.log('✅ Import complete!');
  console.log(`📊 ${data.cases.length} cases | ${data.laws.length} laws | ${data.doctrines.length} doctrines | ${data.users.length} users`);
  
  mongoose.disconnect();
}

importData().catch(console.error);

