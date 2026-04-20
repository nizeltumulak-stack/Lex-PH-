const axios = require('axios');
const cheerio = require('cheerio');
const { performance } = require('perf_hooks');

/**
 * Supreme Court E-Library Scraper
 * Searches https://elibrary.judiciary.gov.ph
 * @param {string} query - Legal search query
 * @returns {Promise<Array>} Array of case results (max 20)
 */
async function searchSCJudiciary(query) {
  const startTime = performance.now();
  const results = [];
  let page = 1;
  const maxPages = 2; // 10 results per page = 20 max
  
  const baseUrl = 'https://elibrary.judiciary.gov.ph';
  const searchUrl = `${baseUrl}/thebookshelf/showdocs/1/${encodeURIComponent(query)}`;
  
  try {
    console.log(`🔍 SC Judiciary searching: "${query}" (page ${page})`);
    
    // First page
    const { data: html } = await axios.get(searchUrl, {
      timeout: 10000, // 10s timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    const $ = cheerio.load(html);
    
    // Extract results from table rows
    $('table tr').slice(1).each((i, row) => { // Skip header
      const cols = $(row).find('td');
      if (cols.length < 5) return;
      
      const titleLink = cols.eq(0).find('a');
      const grNo = cols.eq(1).text().trim();
      const date = cols.eq(2).text().trim();
      const ponente = cols.eq(3).text().trim();
      const division = cols.eq(4).text().trim();
      
      if (titleLink.length && grNo) {
        const caseData = {
          title: titleLink.text().trim(),
          gr_number: grNo,
          date_decided: date,
          ponente: ponente || null,
          division: division || null,
          url: titleLink.attr('href') ? new URL(titleLink.attr('href'), baseUrl).href : null,
          source: 'SC E-Library',
          snippet: cols.eq(5)?.text().trim().substring(0, 200) || ''
        };
        
        if (caseData.title.length > 10) {
          results.push(caseData);
        }
      }
    });
    
    console.log(`✅ SC Judiciary: ${results.length} results (page 1)`);
    
    // Pagination (if needed)
    if (results.length < 20 && page < maxPages) {
      page++;
      const paginatedUrl = `${searchUrl}&page=${page}`;
      try {
        const { data: pageHtml } = await axios.get(paginatedUrl, { timeout: 8000 });
        const $page = cheerio.load(pageHtml);
        
        $page('table tr').slice(1).each((i, row) => {
          const cols = $page(row).find('td');
          if (cols.length < 5) return;
          
          const titleLink = cols.eq(0).find('a');
          const grNo = cols.eq(1).text().trim();
          
          if (titleLink.length && grNo && results.length < 20) {
            const caseData = {
              title: titleLink.text().trim(),
              gr_number: grNo,
              date_decided: cols.eq(2).text().trim(),
              ponente: cols.eq(3).text().trim() || null,
              division: cols.eq(4).text().trim() || null,
              url: titleLink.attr('href') ? new URL(titleLink.attr('href'), baseUrl).href : null,
              source: 'SC E-Library (Page 2)',
              snippet: cols.eq(5)?.text().trim().substring(0, 200) || ''
            };
            
            if (caseData.title.length > 10) {
              results.push(caseData);
            }
          }
        });
        
        console.log(`✅ SC Judiciary Page 2: +${results.length - (page-1)*10} results`);
      } catch (pageError) {
        console.log('⚠️ Pagination failed (non-critical):', pageError.message);
      }
    }
    
    const duration = Math.round(performance.now() - startTime);
    console.log(`⏱️ SC Judiciary total: ${results.length} results in ${duration}ms`);
    
    return results.slice(0, 20);
    
  } catch (error) {
    console.error(`❌ SC Judiciary scraper failed: ${error.message}`);
    return [];
  }
}

module.exports = { search: searchSCJudiciary };

// Test usage:
// node -e "const { search } = require('./scJudiciaryScraper'); search('illegal dismissal').then(console.log)"

