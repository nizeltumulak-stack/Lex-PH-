const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Senate of the Philippines Scraper
 * https://senate.gov.ph
 */
async function searchSenate(query) {
  const baseUrl = 'https://senate.gov.ph';
  const searchUrl = `${baseUrl}/search.asp?${new URLSearchParams({ q: query })}`;

  try {
    console.log(`🔍 Senate.gov.ph searching: "${query}"`);

    const { data: html } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(html);
    const results = [];

    // Senate search results selectors
    const selectors = [
      '.search-result h3 a',
      '.result-title a', 
      '#search-results a',
      '.listhit a',
      'h4 a'
    ];

    for (const selector of selectors) {
      $(selector).slice(0, 5).each((i, linkEl) => {
        if (results.length >= 8) return false;

        const title = $(linkEl).text().trim();
        const href = $(linkEl).attr('href');
        
        if (!title || title.length < 15 || !href) return;

        const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
        const parentText = $(linkEl).parent().parent().text();

        // Extract bill/law number, date
        const numberMatch = parentText.match(/(SB?|PL|RA?) No?\.?.*?\\d+|Bill No\. \\d+/i);
        const dateMatch = parentText.match(/(\\d{1,2}\\/\\d{1,2}\\/\\d{4}|[A-Za-z]+ \\d+, \\d{4})/);

        results.push({
          title,
          document_number: numberMatch ? numberMatch[1].trim() : null,
          date: dateMatch ? dateMatch[1].trim() : null,
          category: 'senate-bill-law',
          url: fullUrl,
          source: 'Senate.gov.ph',
          excerpt: parentText.substring(0, 200).replace(/\n/g, ' ').trim() + '...'
        });
      });

      if (results.length >= 8) break;
    }

    console.log(`✅ Senate: ${results.length} bills/laws`);
    return results;

  } catch (error) {
    console.error(`❌ Senate scraper failed: ${error.message}`);
    return [];
  }
}

module.exports = { search: searchSenate };

