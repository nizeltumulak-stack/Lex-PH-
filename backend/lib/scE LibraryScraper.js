const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Supreme Court E-Library Scraper (Philippines)
 * https://elibrary.judiciary.gov.ph
 * Extracts GR cases, ponente, dates, full decision URLs
 */

class SCElibraryScraper {
  constructor() {
    this.baseUrl = 'https://elibrary.judiciary.gov.ph';
    this.searchUrl = `${this.baseUrl}/elibrarysearch`;
    this.timeout = 10000;
    this.maxPages = 3; // Up to ~30 results
    this.resultsPerPage = 10;
    this.delayBetweenRequests = 1500; // Rate limiting
  }

  /**
   * Main search function - query → structured JSON
   * @param {string} query - Legal search terms
   * @param {number} maxResults - Max results to return (default 20)
   * @returns {Promise<Array>} Structured case results
   */
  async search(query, maxResults = 20) {
    const results = [];
    
    try {
      console.log(`🔍 SC E-Library: "${query}" (target: ${maxResults})`);
      
      let page = 1;
      let totalResults = 0;
      
      while (totalResults < maxResults && page <= this.maxPages) {
        const pageResults = await this.scrapePage(query, page);
        results.push(...pageResults);
        totalResults += pageResults.length;
        
        console.log(`📄 Page ${page}: +${pageResults.length} results (total: ${totalResults})`);
        
        if (pageResults.length === 0 || totalResults >= maxResults) break;
        
        page++;
        await this.delay(this.delayBetweenRequests);
      }
      
      // Post-process: enhance with full decision URLs where possible
      const enhancedResults = await this.enhanceResults(results.slice(0, maxResults));
      
      return enhancedResults;
      
    } catch (error) {
      console.error('❌ SC E-Library search failed:', error.message);
      throw new Error(`SC E-Library scrape failed: ${error.message}`);
    }
  }

  /**
   * Scrape single search results page
   */
  async scrapePage(query, pageNum) {
    const searchParams = new URLSearchParams({
      q: query,
      page: pageNum.toString(),
      per_page: this.resultsPerPage.toString()
    });

    const url = `${this.searchUrl}?${searchParams.toString()}`;
    
    const response = await axios.get(url, {
      timeout: this.timeout,
      headers: this.getHeaders(),
      maxRedirects: 5
    });

    const $ = cheerio.load(response.data);
    const pageResults = [];

    // SC E-Library result selectors (reverse-engineered)
    $('.search-result, .result-item, tr.result-row, .case-item').each((i, element) => {
      const $row = $(element);
      
      // Extract case title (usually in h3/a or .title)
      let caseTitle = $row.find('h3 a, .title a, a[href*="/case"], a[href*="/thejurisprudence"]').first().text().trim() || 
                      $row.find('a').first().text().trim();
      
      // GR Number pattern
      const grMatch = $row.text().match(/G\.R\. No\.\s*(\d+(?:\s*\/\s*\d+)*)/i) ||
                      $row.text().match(/G\.R\.\s*No\.\s*(\d+)/i);
      const grNumber = grMatch ? grMatch[1] : null;
      
      // Date (various formats)
      const dateMatch = $row.text().match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i) ||
                        $row.text().match(/(\d{4}-\d{2}-\d{2})/) ||
                        $row.text().match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      const dateDecided = dateMatch ? dateMatch[0] : 'N/A';
      
      // Ponente (Justice name)
      const ponenteMatch = $row.text().match(/(?:ponente|justice|j\.)?\s*:?\s*([A-Z][a-z]+\s+(?:[A-Z]\.)?\s+[A-Z][a-z]+)/i);
      const ponente = ponenteMatch ? ponenteMatch[1] : 'N/A';
      
      // Division (First/Second/En Banc)
      const divisionMatch = $row.text().match(/(first|second|third|en banc)/i);
      const division = divisionMatch ? divisionMatch[1].toUpperCase() : 'N/A';
      
      // Full decision URL
      const decisionLink = $row.find('a[href*="/fulltext"], a[href*="/view"], a[href*="/pdf"]').first().attr('href') ||
                          $row.find('a').first().attr('href');
      const fullTextUrl = decisionLink ? new URL(decisionLink, this.baseUrl).href : null;
      
      // Result URL (detail page)
      const resultLink = $row.find('a').first().attr('href');
      const resultUrl = resultLink ? new URL(resultLink, this.baseUrl).href : null;

      if (caseTitle && grNumber) {
        pageResults.push({
          case_title: caseTitle.slice(0, 200),
          gr_number: grNumber,
          date_decided: dateDecided,
          ponente,
          division,
          result_url: resultUrl,
          full_text_url: fullTextUrl,
          source: 'SC E-Library',
          scraped_at: new Date().toISOString()
        });
      }
    });

    return pageResults;
  }

  /**
   * Enhance results with additional detail scraping (optional)
   */
  async enhanceResults(results) {
    const enhanced = [];
    
    for (const result of results) {
      try {
        if (result.result_url) {
          const detailResponse = await axios.get(result.result_url, {
            timeout: 8000,
            headers: this.getHeaders()
          });
          
          const $ = cheerio.load(detailResponse.data);
          
          // Try to extract more detailed summary
          const additionalSummary = $('.case-summary, .synopsis, .facts, p').first().text().trim().slice(0, 500);
          if (additionalSummary && additionalSummary.length > 50) {
            result.enhanced_summary = additionalSummary;
          }
        }
        enhanced.push(result);
      } catch (error) {
        console.warn(`⚠️ Detail enhancement failed for ${result.gr_number}:`, error.message);
        enhanced.push(result); // Keep original
      }
      
      // Rate limit between detail requests
      await this.delay(1000);
    }
    
    return enhanced;
  }

  /**
   * Rate limiting delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Realistic browser headers to avoid blocking
   */
  getHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0'
    };
  }
}

module.exports = SCElibraryScraper;

