const axios = require('axios');
const cheerio = require('cheerio');
const { setTimeout: delay } = require('timers/promises');

/**
 * LawPhil.net Multi-Category Scraper
 * Searches jurisprudence, statutes, and executive issuances
 */
class LawPhilScraper {
  constructor() {
    this.baseUrl = 'https://lawphil.net';
    this.rateLimitDelay = 1200; // 1.2s between requests
  }

  /**
   * Main search function - queries all categories in parallel
   * @param {string} query - Legal search query
   * @returns {Promise<Array>} Unified results sorted by date
   */
  async search(query) {
    console.log(`🔍 LawPhil searching: "${query}"`);
    
    const searchPromises = [
      this.searchSupremeCourt(query),
      this.searchCourtAppeals(query),
      this.searchRepublicActs(query),
      this.searchPresidentialDecrees(query),
      this.searchExecutiveOrders(query)
    ];

    const [scResults, caResults, raResults, pdResults, eoResults] = await Promise.allSettled(searchPromises);
    
    const allResults = [
      ...(scResults.status === 'fulfilled' ? scResults.value : []),
      ...(caResults.status === 'fulfilled' ? caResults.value : []),
      ...(raResults.status === 'fulfilled' ? raResults.value : []),
      ...(pdResults.status === 'fulfilled' ? pdResults.value : []),
      ...(eoResults.status === 'fulfilled' ? eoResults.value : [])
    ];

    // Sort by date descending (newest first)
    const sortedResults = allResults
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 12); // Max 12 total results

    console.log(`✅ LawPhil: ${sortedResults.length} results across ${allResults.length} raw`);
    return sortedResults;
  }

  async searchSupremeCourt(query) {
    return await this.searchCategory('/judjuris/juri', 'Supreme Court', query);
  }

  async searchCourtAppeals(query) {
    return await this.searchCategory('/judjuris/ca', 'Court of Appeals', query);
  }

  async searchRepublicActs(query) {
    return await this.searchCategory('/statutes/repacts', 'Republic Acts', query);
  }

  async searchPresidentialDecrees(query) {
    return await this.searchCategory('/statutes/presdecs', 'Presidential Decrees', query);
  }

  async searchExecutiveOrders(query) {
    return await this.searchCategory('/statutes/eos', 'Executive Orders', query);
  }

  /**
   * Generic category search with rate limiting
   */
  async searchCategory(path, categoryName, query) {
    try {
      const searchUrl = `${this.baseUrl}${path}?q=${encodeURIComponent(query)}`;
      
      await delay(this.rateLimitDelay); // Rate limit
      
      const { data: html } = await axios.get(searchUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const $ = cheerio.load(html);
      const results = [];

      // Extract search results
      $('table tr, .search-result, .result-item').slice(1, 11).each((i, row) => { // Top 10 per category
        const $row = $(row);
        const titleLink = $row.find('a[href*="/show"], a[href*="/judjuris"], a[href*="/statutes"]').first();
        
        if (titleLink.length === 0) return;

        const title = titleLink.text().trim();
        const url = titleLink.attr('href');
        const fullUrl = url.startsWith('http') ? url : new URL(url, this.baseUrl).href;
        
        // Extract metadata from row or parent
        const rowText = $row.text();
        const grMatch = rowText.match(/(G\.R\. No\..*?)(?=\s|$)/i);
        const raMatch = rowText.match(/(RA? \d+|Republic Act No\. \d+)/i);
        const dateMatch = rowText.match(/(\\d{1,2} [A-Za-z]+ \\d{4})/);
        
        results.push({
          title,
          gr_number: grMatch ? grMatch[1].trim() : (raMatch ? raMatch[1].trim() : null),
          date_decided: dateMatch ? dateMatch[1].trim() : null,
          category: categoryName,
          url: fullUrl,
          source: 'LawPhil.net',
          snippet: rowText.substring(0, 200).trim() + '...'
        });
      });

      return results;
      
    } catch (error) {
      console.log(`⚠️ LawPhil ${categoryName} failed: ${error.message}`);
      return [];
    }
  }
}

module.exports = { search: new LawPhilScraper().search };

// Standalone test
// node -e "
//   const { search } = require('./lawphilScraper');
//   search('illegal dismissal').then(console.log)
// "

