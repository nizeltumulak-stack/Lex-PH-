require("dotenv").config();
const tavily = require("@tavily/core");
const { Groq } = require("groq-sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const NodeCache = require("node-cache");

const cache = new NodeCache({ stdTTL: 3600 });

const tavilyClient = tavily.tavily({ apiKey: process.env.TAVILY_API_KEY });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const geminiKeys = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean);
let geminiIndex = 0;

async function getGemini() {
  const key = geminiKeys[geminiIndex % geminiKeys.length];
  geminiIndex++;
  return new GoogleGenerativeAI(key);
}

async function analyzeLexph(query) {
  const cacheKey = "lexph:" + query.toLowerCase().trim();
  if (cache.has(cacheKey)) {
    console.log("?? Returning cached result...");
    return cache.get(cacheKey);
  }

  console.log("?? Searching via Tavily...");
  const searchResults = await tavilyClient.search(query, {
    maxResults: 10,
    searchDepth: "advanced",
    includeAnswer: true
  });

  const context = searchResults.results
    .map(r => r.title + ": " + r.content)
    .join("\n\n");

  let analysis;
  try {
    console.log("?? Analyzing with Groq...");
    const groqChat = await groq.chat.completions.create({
      messages: [{
        role: "user",
        content: "Philippine Legal Analysis for: " + query + "\n\nContext:\n" + context + "\n\nProvide:\n1. SUMMARY\n2. SOURCES\n3. FACT-CHECK\n4. RELATED LAWS\n\nFormat as markdown."
      }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      max_tokens: 2000
    });
    analysis = groqChat.choices[0].message.content;
    console.log("? Groq OK!");
  } catch (groqErr) {
    console.log("? Groq failed, trying Gemini...");
    try {
      const genAI = await getGemini();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const geminiResult = await model.generateContent(
        "Philippine Legal Analysis for: " + query + "\n\nContext:\n" + context + "\n\nProvide:\n1. SUMMARY\n2. SOURCES\n3. FACT-CHECK\n4. RELATED LAWS\n\nFormat as markdown."
      );
      analysis = geminiResult.response.text();
      console.log("? Gemini OK!");
    } catch (geminiErr) {
      console.error("? All APIs failed!");
      analysis = "Sorry, AI is temporarily unavailable. Please try again.";
    }
  }

  cache.set(cacheKey, analysis);
  return analysis;
}

module.exports = { analyzeLexph };
