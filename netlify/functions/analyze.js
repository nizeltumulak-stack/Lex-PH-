const { analyzeLexph } = require('../../lexph-cli/lexphService');

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);
    if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'No query provided' }) };
    
    const result = await analyzeLexph(query);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
