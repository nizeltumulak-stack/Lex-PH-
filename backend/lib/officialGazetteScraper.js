const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Philippine Official Gazette Scraper
 * https://www.officialgazette.gov.ph
 */
async function scrapeOfficialGazette(query) {
  const baseUrl = 'https://www.officialgazette.gov.ph';
  
  // Search categories
  const searchPaths = [
    { path: '/search-results/?q=', name: 'general' },
    { path: '/section/legal/legal-acts/?s=', name: 'legal-acts' },
    { path: '/section/legal/executive-issuances/?s=', name: 'executive-orders' },
    { path: '/section/legal/proclamations/?s=', name: 'proclamations' }
  ];

  try {
    console.log(`🔍 Official Gazette searching: "${query}"`);
    const allResults = [];

    // Parallel search all categories
    const searchPromises = searchPaths.map(async ({ path, name }) => {
      const searchUrl = `${baseUrl}${path}${encodeURIComponent(query)}`;
      
      try {
        const { data: html } = await axios.get(searchUrl, {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9'
          }
        });

        const $ = cheerio.load(html);
        const categoryResults = [];

        // Extract results (multiple possible selectors)
        const resultSelectors = [
          '.search-result',
          '.entry-title a',
          '.post-title a', 
          '.gazette-entry a',
          'article h2 a',
          '.search-item a'
        ];

        for (const selector of resultSelectors) {
          $(selector).slice(0, 3).each((i, linkEl) => { // 3 per category
            if (categoryResults.length >= 3) return false;

            const $link = $(linkEl);
            const title = $link.text().trim();
            const href = $link.attr('href');
            
            if (!title || title.length < 10 || !href) return;

            const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
            const parentText = $link.parent().text();

            // Parse metadata
            const docTypeMatch = parentText.match(/(law|act|executive order|proclamation|e\.o\.?|ra?|pd?)/i);
            const dateMatch = parentText.match(/(\\d{1,2}\\/\\d{1,2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2}|[A-Za-z]+ \\d+, \\d{4})/);
            const numberMatch = parentText.match(/(RA?|PD?|EO?) No?\.?.*?\\d+|No?\.?.*?\\d+)/i);

            categoryResults.push({
              title: title.substring(0, 150),
              document_type: docTypeMatch ? docTypeMatch[1].toUpperCase() : name,
              date_signed: dateMatch ? dateMatch[1].trim() : null,
              document_number: numberMatch ? numberMatch[1].trim() : null,
              url: fullUrl,
              source: 'Official Gazette',
              category: name,
              excerpt: parentText.substring(0, 300).trim() + '...'
            });
          });

          if (categoryResults.length >= 3) break;
        }

        return categoryResults;
      } catch (catError) {
        console.log(`⚠️ Gazette ${name} failed:`, catError.message);
        return [];
      }
    });

    const categoryResults = await Promise.all(searchPromises);
    const unifiedResults = categoryResults.flat();

    // Top 8 total results (deduplicated by URL)
    const uniqueResults = unifiedResults.filter((result, index, self) => 
      index === self.findIndex(r => r.url === result.url)
    ).slice(0, 8);

    console.log(`✅ Official Gazette: ${uniqueResults.length} results`);
    return uniqueResults;

  } catch (error) {
    console.error('❌ Official Gazette scraper failed:', error.message);
    return [];
  }
}

/**
 * Fetch full text from Official Gazette URL
 * @param {string} url - Full document URL
 * @returns {Object} Parsed document data
 */
async function fetchFullGazetteDoc(url) {
  try {
    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(html);
    let fullText = '';

    // Extract main content
    const contentSelectors = [
      '.entry-content',
      '.post-content', 
      '.gazette-content',
      'article p',
      '.single-post p'
    ];

    for (const selector of contentSelectors) {
      const content = $(selector).text();
      if (content.length > 500) {
        fullText = content.trim();
        break;
      }
    }

    // Clean and structure
    const text = fullText
      .replace(/\\s+/g, ' ')
      .substring(0, 8000);

    const keyProvisions = text.substring(0, 2500);

    return {
      url,
      title: $('h1, .entry-title').first().text().trim(),
      full_text: text,
      key_provisions: keyProvisions,
      word_count: text.split(' ').length,
      source: 'Official Gazette (Full)',
      extracted_at: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Full Gazette doc failed:', error.message);
    return { url, error: error.message, source: 'Official Gazette' };
  }
}

module.exports = {
  search: scrapeOfficialGazette,
  fetchFullDoc: fetchFullGazetteDoc
};

// Test
// node -e "
//   const { search } = require('./officialGazetteScraper');
//   search('Republic Act 11232').then(console.log)
// "

