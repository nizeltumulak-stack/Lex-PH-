const axios = require('axios');
const cheerio = require('cheerio');

/**
 * ChanRobles.com Scraper
 * Searches Supreme Court cases, statutes, and Constitution
 * URL: https://www.chanrobles.com/search.htm?q={query}
 */
async function searchChanRobles(query) {
  const baseUrl = 'https://www.chanrobles.com';
  const searchUrl = `${baseUrl}/search.htm?q=${encodeURIComponent(query)}`;
  
  try {
    console.log(`🔍 ChanRobles searching: "${query.substring(0, 40)}..."`);
    
    const { data: html } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      }
    });

    const $ = cheerio.load(html);
    const results = [];

    // Target search results container (top 10)
    $('.search-result, .result-item, .entry, tr:has(a), .post').slice(0, 10).each((i, el) => {
      const $el = $(el);
      
      // Title & link
      const titleEl = $el.find('h3 a, .title a, a[href*="/sc/"], a[href*="/statutes/"], a').first();
      if (!titleEl.length) return;
      
      const title = titleEl.text().trim();
      const url = titleEl.attr('href');
      const fullUrl = url.startsWith('http') ? url : new URL(url, baseUrl).href;

      // Category detection from URL/path or title
      let category = 'general';
      if (fullUrl.includes('/sc/') || title.match(/G\.R\.|G.R\. No\./i)) {
        category = 'supreme-court';
      } else if (fullUrl.includes('/statutes/') || title.match(/RA \d+|Republic Act/i)) {
        category = 'statute';
      } else if (fullUrl.includes('/constitution/') || title.includes('1987 Constitution')) {
        category = 'constitution';
      }

      // Date from meta or text
      const dateMatch = $el.text().match(/(\\d{1,2} [A-Za-z]+ \\d{4}|\\d{4}-\\d{2}-\\d{2})/);
      const date = dateMatch ? dateMatch[1].trim() : null;

      // Excerpt/summary (next elements or description)
      const summary = $el.find('.summary, .excerpt, .description, p').first().text()
        .trim()
        .substring(0, 250);

      results.push({
        title,
        category,
        date_decided: date,
        excerpt: summary || null,
        url: fullUrl,
        source: 'ChanRobles.com',
        relevance_rank: i + 1 // Native search ranking
      });
    });

    console.log(`✅ ChanRobles: ${results.length}/10 results`);
    return results;

  } catch (error) {
    console.error(`❌ ChanRobles scraper failed: ${error.message}`);
    
    if (error.code === 'ENOTFOUND' || error.response?.status >= 500) {
      // Server issues - try fallback static results
      return [{
        title: 'Philippine Jurisprudence Portal',
        category: 'general',
        date_decided: new Date().toLocaleDateString(),
        excerpt: 'ChanRobles temporarily unavailable. Try SC E-Library or LawPhil.',
        url: 'https://www.chanrobles.com/',
        source: 'ChanRobles.com (Fallback)'
      }];
    }
    
    return [];
  }
}

module.exports = { search: searchChanRobles };

// Test
// node -e "
//   const { search } = require('./chanroblesScraper');
//   search('illegal dismissal').then(console.log)
// "

