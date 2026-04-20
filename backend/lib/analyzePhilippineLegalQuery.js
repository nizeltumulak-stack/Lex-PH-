const OpenAI = require('openai');
const mongoose = require('mongoose');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY
});

const SYSTEM_PROMPT = `You are a Philippine legal research assistant with expertise in:

• 1987 Philippine Constitution  
• Civil Code of the Philippines (RA 386)
• Family Code (EO 209)
• Revised Penal Code (Act 3815)
• Rules of Court (A.M. No. 19-10-20-SC)
• Labor Code (PD 442)
• Supreme Court jurisprudence (1990-2024)
• Republic Acts (RA 9165, RA 11232, etc.)
• Special laws (Anti-Terrorism Law RA 11479)

Analyze the provided legal documents and respond EXACTLY in this JSON structure:

{
  "conclusion": "Direct 1-2 sentence legal answer under PH law",
  "hierarchy": [
    {"level": "Constitution", "provisions": ["Art. III Sec. 1"]},
    {"level": "Statute", "provisions": ["Art. 1156 Civil Code", "RA 11232 Sec. 23"]}, 
    {"level": "Jurisprudence", "cases": ["G.R. No. 158693 (Agabon, 2004)"]}
  ],
  "key_cases": [
    {
      "gr_number": "G.R. No. 158693",
      "title": "Agabon v. NLRC", 
      "date": "Nov 17, 2004",
      "court": "Supreme Court",
      "doctrine": "Nominal damages P30K for procedural due process violation",
      "status": "GOOD", // GOOD/MODIFIED/OVERRULED
      "relevance": "Directly on-point"
    }
  ],
  "cited_laws": [
    "Civil Code Art. 1156-1173 (Obligations)",
    "Labor Code Art. 294 (Security of Tenure)",
    "RA 11232 Sec. 23 (Revised Corp Code)"
  ],
  "practical_implications": [
    "Employer liable for P30K nominal damages",
    "Employee entitled to reinstatement if no just cause"
  ],
  "confidence": "HIGH|MEDIUM|LOW",
  "confidence_reason": "Multiple recent SC decisions + direct statutory basis",
  "recommendations": [
    "Consult counsel for case-specific application",
    "Check if cited cases modified by later rulings"
  ],
  "query": "original user query"
}

CRITICAL RULES:
• Cite SPECIFIC GR numbers + DATES
• Cite EXACT RA numbers + SECTION/ARTICLE  
• Flag OVERRULED cases (Agabon doctrine modified)
• Hierarchy: Constitution > Statute > SC > CA > RTC
• Confidence LOW if <3 recent sources
`;

const ANALYSIS_CACHE_SCHEMA = new mongoose.Schema({
  query_hash: { type: String, unique: true, required: true },
  userQuery: String,
  documents: [Object],
  analysis: Object,
  expiresAt: { type: Date, index: true }
}, { expires: 60 * 60 * 24 }); // 24h TTL

const AnalysisCache = mongoose.models.AnalysisCache || mongoose.model('AnalysisCache', ANALYSIS_CACHE_SCHEMA);

/**
 * Analyze Philippine legal query with expert AI
 * @param {string} userQuery - User's legal question
 * @param {Array} documents - Array of scraped legal docs  
 * @returns {Promise<Object>} Structured JSON analysis
 */
async function analyzePhilippineLegalQuery(userQuery, documents) {
  const queryHash = crypto.createHash('md5')
    .update(JSON.stringify({ query: userQuery, docIds: documents.map(d => d.url) }))
    .digest('hex');

  try {
    // 1. Cache check (24h)
    const cached = await AnalysisCache.findOne({ 
      query_hash: queryHash,
      expiresAt: { $gt: new Date() }
    });
    
    if (cached) {
      console.log('💾 Cache HIT');
      return cached.analysis;
    }

    // 2. Prepare context (top 8 docs, 12K token limit)
    const context = documents
      .slice(0, 8)
      .map(doc => ({
        title: doc.title || 'Document',
        source: doc.source,
        url: doc.url,
        gr_number: doc.gr_number,
        date: doc.date_decided,
        excerpt: (doc.raw_full_text || doc.excerpt || '').substring(0, 1200)
      }));

    const contextString = JSON.stringify(context, null, 2).substring(0, 14000);

    // 3. AI Analysis (OpenAI GPT-4o-mini)
    const completion = await openai.chat.completions.create({
      model: process.env.GROQ_API_KEY ? 'llama3-70b-8192' : 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { 
          role: 'user', 
          content: `QUERY: "${userQuery}"

PHILIPPINE LEGAL DOCUMENTS (${context.length} sources):
${contextString}

Provide EXACT JSON analysis.`
        }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });

    let analysis = {};
    try {
      // Parse AI JSON response
      analysis = JSON.parse(completion.choices[0].message.content.trim());
    } catch (parseError) {
      console.log('JSON parse failed, using fallback structure');
      analysis = {
        conclusion: completion.choices[0].message.content.substring(0, 400),
        confidence: 'MEDIUM',
        query: userQuery,
        cited_laws: [],
        key_cases: [],
        hierarchy: []
      };
    }

    // 4. Validate/structure response
    const structuredAnalysis = {
      conclusion: analysis.conclusion || 'Analysis requires more recent/authoritative sources.',
      hierarchy: Array.isArray(analysis.hierarchy) ? analysis.hierarchy.slice(0, 5) : [],
      key_cases: Array.isArray(analysis.key_cases) ? analysis.key_cases.slice(0, 6) : [],
      cited_laws: Array.isArray(analysis.cited_laws) ? analysis.cited_laws.slice(0, 15) : [],
      practical_implications: Array.isArray(analysis.practical_implications) ? analysis.practical_implications : [],
      confidence: analysis.confidence || 'LOW',
      confidence_reason: analysis.confidence_reason || 'Limited recent authoritative sources',
      recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations.slice(0, 5) : [],
      query: userQuery,
      documents_analyzed: documents.length,
      status_flags: checkCaseStatus(analysis.key_cases || [])
    };

    // 5. Cache valid analyses (high confidence only)
    if (structuredAnalysis.confidence === 'HIGH' || structuredAnalysis.confidence === 'MEDIUM') {
      await new AnalysisCache({
        query_hash: queryHash,
        userQuery,
        documents: context,
        analysis: structuredAnalysis,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
      }).save();
    }

    console.log(`✅ PH Legal Analysis: ${structuredAnalysis.confidence} (${documents.length} docs)`);
    return structuredAnalysis;

  } catch (error) {
    console.error('❌ Legal analysis failed:', error.message);
    return {
      query: userQuery,
      error: error.message,
      confidence: 'FAILED',
      conclusion: 'Analysis service temporarily unavailable',
      documents_analyzed: documents.length
    };
  }
}

/**
 * Flag overturned/modified cases (maintain known list)
 */
function checkCaseStatus(cases) {
  const knownCases = {
    'G.R. No. 158693': { status: 'MODIFIED', note: 'Agabon doctrine - nominal damages now P50K (Jaka Food Processing)' },
    'G.R. No. 120077': { status: 'GOOD', note: 'Manila Hotel - foundational twin-notice rule' },
    'G.R. No. 179987': { status: 'GOOD', note: 'Malabanan - land registration standard' }
  };

  return cases.map(caseInfo => ({
    gr_number: caseInfo.gr_number,
    status: knownCases[caseInfo.gr_number]?.status || 'UNKNOWN',
    note: knownCases[caseInfo.gr_number]?.note || 'Status not tracked'
  }));
}

module.exports = { analyzePhilippineLegalQuery };

// Test
// node -e "
//   const { analyzePhilippineLegalQuery } = require('./analyzePhilippineLegalQuery');
//   analyzePhilippineLegalQuery('illegal dismissal', [{title: 'test', raw_full_text: 'test content'}]).then(console.log)
// "

