#!/usr/bin/env node

const readline = require('readline');
const { analyzeLexph } = require('./lexphService.js');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🚀 LexPH CLI - Philippine Legal Research AI');
console.log('=======================================');
console.log('Enter legal queries (type "exit" to quit):\n');

async function prompt() {
  rl.question('💼 ', async (query) => {
    if (query.toLowerCase() === 'exit') {
      console.log('👋 Goodbye!');
      rl.close();
      return;
    }

    if (!query.trim()) {
      prompt();
      return;
    }

    try {
      console.log('\n⏳ Processing...\n');
      const result = await analyzeLexph(query);
      console.log(result);
      console.log('\n' + '='.repeat(60) + '\n');
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
    prompt();
  });
}

prompt();
