const LegalResearchAPIs = require('./legalResearchAPIs');

/**
 * legalSearchAggregator - Parallel Legal API Aggregator Service
 * Queries multiple APIs simultaneously, dedupes, ranks, returns top 10
 */

class LegalSearchAggregator {
  constructor(options = {}) {
    this.apis = new LegalResearchAPIs(options.apiKeys || {});
    this.concurrency = options.concurrency || 3;
    this.maxResults = options.maxResults || 10;
    this.relevanceThreshold = options.relevanceThreshold || 0.3;
  }

  // Core parallel search across specified APIs
  async aggregateSearch(query, apiList = ['courtlistener', 'openstates', 'worldlii', 'scholar']) {
    console.log(`🔍 Aggregating search for "${query}" across ${apiList.length} APIs...`);

    // Split into batches for concurrency control
    const batches = this.chunkArray(apiList, this.concurrency);
    const allRawResults = [];

    // Execute API calls in parallel batches
    for (const batch of batches) {
      const batchPromises = batch.map(apiName => 
        this.executeApiWithRetry(apiName, query)
          .catch(err => {
            console.error(`❌ ${apiName} failed:`, err.message);
            return { source: apiName, results: [], error: err.message };
          })
      );
      
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(result => allRawResults.push(...result.results));
      
      // Small delay between batches for rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    // Process unified results
    const unifiedResults = this.unifyAndDedupe(allRawResults);
    const rankedResults = this.rankAndSort(unifiedResults, query);
    
    console.log(`✅ Aggregation complete: ${rankedResults.length} unique results from ${allRawResults.length} raw`);

    return {
      query,
      raw_count: allRawResults.length,
      unique_count: unifiedResults.length,
      top_results: rankedResults.slice(0, this.maxResults),
      sources_used: [...new Set(allRawResults.map(r => r.source))],
      stats: {
        apis_queried: apiList.length,
        duplicates_removed: allRawResults.length - unifiedResults.length,
        avg_relevance: rankedResults.length ? rankedResults.reduce((sum, r) => sum + (r.relevance || 0), 0) / rankedResults.length : 0
      }
    };
  }

  // Execute single API call with retry logic
  async executeApiWithRetry(apiName, query, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let results = [];
        switch (apiName) {
          case 'courtlistener':
            results = await this.apis.courtListener(query);
            break;
          case 'openstates':
            results = await this.apis.openStates(query);
            break;
          case 'worldlii':
            results = await this.apis.worldLii(query);
            break;
          case 'scholar':
            results = await this.apis.googleScholarLegal(query);
            break;
          default:
            throw new Error(`Unknown API: ${apiName}`);
        }
        
        return { source: apiName, results };
      } catch (error) {
        if (attempt === maxRetries) throw error;
        console.warn(`⚠️ ${apiName} attempt ${attempt} failed, retrying...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  // Unify formats + basic deduplication
  unifyAndDedupe(rawResults) {
    const normalized = rawResults.map(result => ({
      case_name: (result.case_name || result.caseName || result.title || 'Unnamed').trim().toLowerCase(),
      date: result.date || 'N/A',
      summary: (result.summary || result.snippet || result.description || '').trim().slice(0, 500),
      source_url: result.source_url || result.html_url || result.url,
      jurisdiction: result.jurisdiction || 'Unknown',
      source: result.source,
      raw: result
    })).filter(r => r.case_name && r.summary);

    // Dedupe by case_name similarity (fuzzy match)
    const seenTitles = new Set();
    return normalized.filter(item => {
      // Exact match first
      if (seenTitles.has(item.case_name)) return false;
      
      // Fuzzy dedupe (similar titles)
      for (let seen of seenTitles) {
        if (item.case_name.includes(seen.slice(0, 20)) || seen.includes(item.case_name.slice(0, 20))) {
          return false;
        }
      }
      
      seenTitles.add(item.case_name);
      return true;
    });
  }

  // Rank by relevance (TF-IDF + recency) + sort
  rankAndSort(results, query) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    return results
      .map(result => {
        // TF-IDF relevance (term frequency)
        let relevance = 0;
        const docWords = (result.summary + ' ' + result.case_name).toLowerCase().split(/\s+/);
        
        queryWords.forEach(qWord => {
          const matches = docWords.filter(word => 
            word.includes(qWord) || qWord.includes(word)
          );
          relevance += matches.length / Math.max(1, docWords.length);
        });
        
        // Recency boost (newer = better, max 0.3 boost)
        let recencyScore = 0;
        if (result.date !== 'N/A') {
          const date = new Date(result.date);
          const ageYears = (Date.now() - date) / (1000 * 60 * 60 * 24 * 365);
          recencyScore = Math.min(0.3, 1 - Math.min(1, ageYears / 10)); // Decay over 10 years
        }
        
        // Jurisdiction bonus
        const jurisdictionBonus = result.jurisdiction.includes('US') || result.jurisdiction.includes('Federal') ? 0.1 : 0;
        
        return {
          ...result,
          relevance: Math.min(1, relevance + recencyScore + jurisdictionBonus)
        };
      })
      .filter(r => r.relevance >= this.relevanceThreshold)
      .sort((a, b) => b.relevance - a.relevance || new Date(b.date) - new Date(a.date));
  }

  // Utility: chunk array for batching
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

module.exports = LegalSearchAggregator;

