const OpenAI = require('openai');
const { RateLimiterMemory } = require('rate-limiter-flexible');

/**
 * Production Groq API Wrapper
 * Error handling, retry, rate limit, fallback
 */
class GroqClient {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY not set');
    }
    
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: 30000 // 30s
    });
    
    // Rate limiter: 30 req/min
    this.rateLimiter = new RateLimiterMemory({
      points: 30,
      duration: 60
    });
  }
  
  async chat(prompt, options = {}) {
    const { model = 'llama3-70b-8192', maxTokens = 1000, temperature = 0.1 } = options;
    
    // Rate limit check
    try {
      await this.rateLimiter.consume('groq', 1);
    } catch (rejRes) {
      throw new Error(`Rate limited. Retry in ${(rejRes.msBeforeNext / 1000).toFixed(1)}s`);
    }
    
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature,
          stream: false
        });
        
        const result = completion.choices[0]?.message?.content || '';
        return {
          success: true,
          text: result,
          tokens: completion.usage?.total_tokens || 0,
          attempt
        };
        
      } catch (error) {
        lastError = error;
        console.warn(`Groq attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          // Final fallback - rule-based response
          return {
            success: false,
            text: this.fallbackResponse(prompt),
            tokens: 0,
            error: error.message,
            fallback: true
          };
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
    
    throw lastError;
  }
  
  fallbackResponse(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes('contract')) {
      return 'Contract obligations: Check Civil Code Articles 1156-1304. Essential elements: consent, object, cause. Consult premium research for case law.';
    }
    if (lowerPrompt.includes('murder')) {
      return 'Murder (RPC Art. 248): Killing with treachery/evil design. Qualifying circumstance requires intent. Supreme Court cases available via premium search.';
    }
    return 'Legal query received. Please upgrade to premium for full AI analysis and case law.';
  }
  
  async legalAnalyze(query, docs = []) {
    const context = docs.slice(0, 3).map(doc => `${doc.title}: ${doc.content?.substring(0, 200)}`).join('\\n');
    
    const prompt = `PH Legal Expert: Query: "${query}"
Context: ${context}
JSON Response: {"principles": [...], "relevance": 0-100, "cases": [...], "rating": "HIGH/MED/LOW"}`;
    
    return await this.chat(prompt, { model: 'llama3-70b-8192', maxTokens: 600 });
  }
  
  async legalAsk(question) {
    const prompt = `LexPH AI (Philippine Law): ${question}
Cite RPC, Civil Code, GR numbers. Concise/actionable. Structure: 1. Answer, 2. Law, 3. Cases.`;
    
    return await this.chat(prompt, { model: 'llama3-70b-8192', maxTokens: 800 });
  }
}

module.exports = new GroqClient();

