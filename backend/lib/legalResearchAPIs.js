const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Legal Research APIs Module
 * Integrates CourtListener, OpenStates, WorldLII, Google Scholar Legal
 * Returns structured JSON: [{case_name, date, summary, source_url, jurisdiction}]
 */

class LegalResearchAPIs {
  constructor(apiKeys = {}) {
    this.apiKeys = apiKeys;
    this.timeout = 10000; // 10s timeout
    this.baseDelay = 1000; // Rate limiting
  }

  // CourtListener API (US Federal/State case law - FREE)
  async courtListener(query) {
    try {
      const params = {
        q: query,
        type: 'r',
        format: 'json',
        page_size: 5
      };
      const res = await axios.get('https://www.courtlistener.com/api/rest/v3/search/', {
        params,
        timeout: this.timeout,
        headers: { 'User-Agent': 'LexPH/1.0 (legal-research-bot)' }
      });
      
      return res.data.results.map(caseData => ({
        case_name: caseData.caseName || 'Unnamed Case',
        date: caseData.dateFiled || caseData.dateTerminated,
        summary: caseData.snippet || caseData.description || 'No summary available',
        source_url: `https://www.courtlistener.com${caseData.url}`,
        jurisdiction: caseData.docketNumber ? 'US Federal/State' : 'US',
        full_text_url: caseData.cluster || caseData.absolute_url ? `https://www.courtlistener.com${caseData.cluster || caseData.absolute_url}` : null
      }));
    } catch (error) {
      console.error('CourtListener error:', error.message);
      return [];
    }
  }

  // OpenStates API (US State legislation - FREE)
  async openStates(query, state = 'all') {
    try {
      // Search bills across states
      const res = await axios.get('https://openstates.org/api/v1/bills/', {
        params: {
          q: query,
          state: state === 'all' ? null : state,
          per_page: 5,
          apikey: this.apiKeys.openstates
        },
        timeout: this.timeout
      });

      return res.data.map(bill => ({
        case_name: bill.title || bill.bill_id,
        date: bill.created_at || bill.updated_at,
        summary: bill.summary || 'No summary available',
        source_url: bill.html_url || `https://openstates.org${bill.sources[0]?.url}`,
        jurisdiction: bill.state_name || bill.state,
        type: 'legislation',
        full_text_url: bill.sources[0]?.url || null
      }));
    } catch (error) {
      console.error('OpenStates error:', error.message);
      return [];
    }
  }

// Supreme Court E-Library (Philippines - PRIMARY TARGET)
  async scELibrary(query) {
    try {
      const scraper = new (require('./scELibraryScraper'))();
      return await scraper.search(query, 5);
    } catch (error) {
      console.error('SC E-Library error:', error.message);
      return [];
    }
  }

  // WorldLII (International backup)
  async worldLii(query) {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `http://www.worldlii.org/cgi-bin/search.pl?query=${encodedQuery}&method=boolean&meta=%2Fcatalog%2F&mask_path=&mask_worldlii=worldlii&results=5`;
      
      const res = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'LexPH/1.0 (legal-research-bot)',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      const $ = cheerio.load(res.data);
      const results = [];

      $('a[href*="/content/"], a[href*="/cases/"], a[href*="/legis/"]').slice(0, 5).each((i, el) => {
        const title = $(el).text().trim().slice(0, 100);
        const link = $(el).attr('href');
        const fullUrl = link.startsWith('http') ? link : `http://www.worldlii.org${link}`;
        
        const parent = $(el).closest('.result, li, div');
        const summary = parent.find('p, .description, .snippet').first().text().trim().slice(0, 200) || 'Legal document from WorldLII database';
        const dateMatch = summary.match(/\\d{4}/) || parent.text().match(/\\d{4}/);
        const date = dateMatch ? dateMatch[0] : 'N/A';

        results.push({
          case_name: title,
          date,
          summary,
          source_url: fullUrl,
          jurisdiction: 'International/Worldwide'
        });
      });

      return results;
    } catch (error) {
      console.error('WorldLII error:', error.message);
      return [];
    }
  }

  // Google Scholar Legal (Scraping - No official API)
  async googleScholarLegal(query) {
    try {
      const encodedQuery = encodeURIComponent(`"${query}" legal scholar`);
      const url = `https://scholar.google.com/scholar?q=${encodedQuery}&hl=en&as_sdt=4,5`;
      
      const res = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      const $ = cheerio.load(res.data);
      const results = [];

      // Parse Google Scholar case law results
      $('.gs_rt, .gs_rt a, .gs_title a').slice(0, 5).each((i, el) => {
        const titleEl = $(el).is('a') ? $(el) : $(el).find('a');
        const title = titleEl.text().trim().slice(0, 100);
        const link = titleEl.attr('href');
        const fullUrl = link ? `https://scholar.google.com${link}` : null;

        // Extract citation/date
        const snippetEl = $(el).closest('.gs_r, .gsc_r').find('.gs_rs, .gs_a');
        const snippet = snippetEl.text().trim().slice(0, 200);
        const dateMatch = snippet.match(/(\\d{4})/);
        const date = dateMatch ? dateMatch[1] : 'N/A';

        results.push({
          case_name: title,
          date,
          summary: snippet || 'Legal opinion from Google Scholar',
          source_url: fullUrl,
          jurisdiction: 'Global (Google Scholar Legal)',
          note: 'Use for academic reference'
        });
      });

      return results;
    } catch (error) {
      console.error('Google Scholar error:', error.message);
      return [{ case_name: 'Scraping blocked', summary: 'Google Scholar detected bot. Try CourtListener instead.', jurisdiction: 'N/A' }];
    }
  }

  // Unified search across all APIs
  async searchAll(query, options = {}) {
    const {
      apis = ['courtlistener', 'openstates', 'worldlii', 'scholar'],
      state = 'all',
      concurrency = 3
    } = options;

    const results = [];
    
    // Run APIs concurrently (limited to avoid rate limits)
    const apiPromises = apis.map(async (apiName) => {
      await new Promise(resolve => setTimeout(resolve, this.baseDelay * Math.random()));
      
      let apiResults = [];
      switch (apiName) {
        case 'courtlistener':
          apiResults = await this.courtListener(query);
          break;
        case 'openstates':
          apiResults = await this.openStates(query, state);
          break;
        case 'worldlii':
          apiResults = await this.worldLii(query);
          break;
        case 'scholar':
          apiResults = await this.googleScholarLegal(query);
          break;
      }
      
      return {
        source: apiName,
        results: apiResults,
        count: apiResults.length
      };
    });

    const apiResponses = await Promise.allSettled(apiPromises);
    
    apiResponses.forEach((response, i) => {
      if (response.status === 'fulfilled') {
        results.push(...response.value.results.map(r => ({...r, source: response.value.source})));
      }
    });

    // Sort by relevance/date, dedupe
    results.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    
    // Dedupe similar cases
    const seen = new Set();
    const uniqueResults = results.filter(r => {
      const key = (r.case_name || '').slice(0, 50).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      query,
      total_results: uniqueResults.length,
      sources: apis,
      results: uniqueResults.slice(0, 10), // Top 10
      stats: apiResponses.filter(r => r.status === 'fulfilled').map(r => r.value)
    };
  }
}

module.exports = LegalResearchAPIs;

