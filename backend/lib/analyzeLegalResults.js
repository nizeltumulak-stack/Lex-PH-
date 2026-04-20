const mongoose = require('mongoose');
const OpenAI = require('openai');
const dotenv = require('dotenv');

dotenv.config();

// MongoDB Cache Schema
const analysisCacheSchema = new mongoose.Schema({
  query_hash: { type: String, required: true, unique: true },
  userQuery: String,
  documents: [Object],
  analysis: Object,
  createdAt: { type: Date, default: Date.now, expires: '24h' } // Auto-expire after 24h
});
const AnalysisCache = mongoose.models.AnalysisCache || mongoose.model('AnalysisCache', analysisCacheSchema);

// AI Client (OpenAI GPT-4o-mini or switch to Claude)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `You are an expert Philippine legal research assistant. 

Analyze the provided legal documents and user query. Provide a structured response with:

1. **CONCLUSION** (1-2 sentences - direct legal answer)
2. **SUPPORTING CASES** (2-4 key precedents with G.R. No., core doctrine, relevance)
3. **RELEVANT LAWS** (cited codal provisions/statutes with article numbers)
4. **CONFIDENCE** (HIGH/MEDIUM/LOW with explanation)
5. **NEXT STEPS** (practical legal recommendations)

Format exactly as JSON. Focus on Philippine law.`;

async function analyzeLegalResults(searchResults, userQuery) {\n  // Pre-process: score, filter, prioritize\n  const processedResults = preprocessResults(searchResults, userQuery);\n  \n  // ... rest of existing function
  try {
    // 1. Check cache
    const queryHash = require('crypto').createHash('md5')
      .update(JSON.stringify({ query: userQuery, urls: searchResults.map(r => r.url) }))
      .digest('hex');
    
    const cached = await AnalysisCache.findOne({ query_hash: queryHash });
    if (cached) {
      console.log('✓ Cache hit');
      return cached.analysis;
    }

    // 2. Prepare context (top 5 results, 4000 token limit)
    const context = searchResults.slice(0, 5).map(doc => ({
      title: doc.title || 'Untitled',
      source: doc.source || 'Unknown',
      snippet: (doc.raw_content || doc.content || '').substring(0, 1000)
    }));

    // Enhanced context with relevance scores\n    const context = processedResults.slice(0, 6).map(doc => {\n      const summary = doc.raw_content.substring(0, 800) + '...';\n      return {\n        title: doc.title,\n        relevance_score: doc.relevance_score,\n        court: doc.court || 'Unknown',\n        date: doc.date_decided,\n        snippet: summary,\n        source: doc.source\n      };\n    });\n    \n    const contextText = JSON.stringify(context, null, 2);

    // 3. AI Analysis
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // or 'grok-beta' for Groq
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { 
          role: 'user', 
          content: `USER QUERY: "${userQuery}"

LEGAL DOCUMENTS CONTEXT:
${contextText.substring(0, 12000)}

Provide structured JSON analysis.`
        }
      ],
      temperature: 0.1,
      max_tokens: 1500
    });

    const analysisRaw = completion.choices[0].message.content.trim();
    
    // 4. Parse JSON response
    let analysis;
    try {
      analysis = JSON.parse(analysisRaw);
    } catch {
      // Fallback parsing
      analysis = {
        conclusion: analysisRaw.substring(0, 300),
        cases: [],
        laws: [],
        confidence: 'MEDIUM',
        next_steps: 'Consult qualified Philippine attorney for case-specific advice.'
      };
    }

    // 5. Structure & Cache
    const structuredAnalysis = {
      conclusion: analysis.conclusion || '',
      supporting_cases: Array.isArray(analysis.cases) ? analysis.cases.slice(0, 4) : [],
      relevant_laws: Array.isArray(analysis.laws) ? analysis.laws.slice(0, 8) : [],
      confidence: analysis.confidence || 'MEDIUM',
      confidence_explanation: analysis.confidence_reason || '',
      next_steps: analysis.next_steps || [],
      query: userQuery,
      documents_analyzed: context.length,
      sources: searchResults.map(r => r.url)
    };

    // Cache result
    await new AnalysisCache({
      query_hash: queryHash,
      userQuery,
      documents: context,
      analysis: structuredAnalysis
    }).save();

    console.log('✓ AI analysis complete');
    return structuredAnalysis;

  } catch (error) {
    console.error('Analysis failed:', error.message);
    return {
      error: error.message,
      conclusion: 'Unable to analyze. Please try different search terms.',
      confidence: 'LOW',
      next_steps: ['Try more specific query', 'Use browse pages directly']
    };
  }
}

function preprocessResults(results, query) {\n  const now = new Date();\n  const tenYearsAgo = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());\n  \n  return results\n    .map(doc => {\n      // 1. Relevance scoring (0-100)\n      let score = 80;\n      \n      // Keyword match\n      const queryWords = query.toLowerCase().split(/\\s+/);\n      const matches = queryWords.filter(word => \n        (doc.title?.toLowerCase() || '').includes(word) ||\n        (doc.raw_content?.toLowerCase() || '').includes(word)\n      ).length;\n      score += (matches / queryWords.length) * 20;\n      \n      // Date recency (favor newer)\n      if (doc.date_decided) {\n        const docDate = new Date(doc.date_decided);\n        const ageYears = (now - docDate) / (365.25 * 24 * 60 * 60 * 1000);\n        if (ageYears < 2) score += 10;\n        else if (ageYears > 10) score -= 15;\n      }\n      \n      // Court hierarchy\n      const courtBoost = {\n        'Supreme Court': 20,\n        'Court of Appeals': 10,\n        'RTC': 0,\n        'MTC': -5\n      };\n      score += courtBoost[doc.court] || 0;\n      \n      // Length/quality\n      if (doc.raw_content && doc.raw_content.length > 1000) score += 5;\n      \n      return {\n        ...doc,\n        relevance_score: Math.min(100, Math.max(0, Math.round(score))),\n        recency_penalty: ageYears > 10\n      };\n    })\n    .filter(doc => !doc.recency_penalty || doc.relevance_score > 85) // Filter old unless highly relevant\n    .sort((a, b) => b.relevance_score - a.relevance_score)\n    .slice(0, 8); // Top 8\n}\n\n// Export for Express routes\nmodule.exports = { analyzeLegalResults };

// Usage example:
// const { analyzeLegalResults } = require('./analyzeLegalResults');
// const result = await analyzeLegalResults(searchResults, 'elements of quasi-delict');

