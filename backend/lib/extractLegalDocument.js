const cheerio = require('cheerio');
const axios = require('axios');
const { JSDOM } = require('jsdom');

/**
 * Extracts structured data from Philippine legal document URLs
 * @param {string} url - Legal document URL (Lawphil, ChanRobles, SC website, etc)
 * @returns {Promise<Object>} Structured legal document JSON
 */
async function extractLegalDocument(url) {
  try {
    console.log(`Extracting: ${url}`);
    
    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const dom = new JSDOM(html);
    const $ = cheerio.load(dom.window.document);
    
    const doc = {
      url,
      title: '',
      court: 'Supreme Court of the Philippines',
      date_decided: '',
      judge: '',
      issues: [],
      ruling: '',
      cited_laws: [],
      raw_content: '',
      confidence: 0.8,
      source: detectSource(url)
    };
    
    // Source-specific parsers
    await parseBySource($, doc, url);
    
    // Generic fallbacks
    if (!doc.title) doc.title = $('h1, .title, [class*="title"], [class*="case-name"]').first().text().trim() || $('title').text().trim();
    if (!doc.date_decided) {
      const dateMatch = html.match(/(\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
      doc.date_decided = dateMatch ? dateMatch[1] : '';
    }
    
    // Extract raw content
    doc.raw_content = $('.body, .content, article, .main-content, #content').first().text().trim().substring(0, 5000) || '';
    
    // Clean up
    doc.issues = doc.issues.filter(i => i.length > 10);
    doc.cited_laws = [...new Set(doc.cited_laws.filter(l => l.length > 5))];
    
    doc.confidence = calculateConfidence(doc);
    
    return doc;
    
  } catch (error) {
    console.error(`Extraction failed for ${url}:`, error.message);
    return {
      url,
      error: error.message,
      title: 'Extraction failed',
      confidence: 0
    };
  }
}

function detectSource(url) {
  if (url.includes('lawphil.net')) return 'Lawphil';
  if (url.includes('chanrobles.com')) return 'ChanRobles';
  if (url.includes('sc.judiciary.gov.ph')) return 'Supreme Court';
  if (url.includes('officialgazette.gov.ph')) return 'Official Gazette';
  return 'Unknown';
}

async function parseBySource($, doc, url) {
  const source = detectSource(url);
  
  switch (source) {
    case 'Lawphil':
      parseLawphil($, doc);
      break;
    case 'ChanRobles':
      parseChanRobles($, doc);
      break;
    case 'Supreme Court':
      parseSCJudiciary($, doc);
      break;
    default:
      parseGeneric($, doc);
  }
}

function parseLawphil($, doc) {
  // Title
  doc.title = $('.article-header h1').first().text().trim();
  
  // Date
  const dateMatch = $('.article-meta').text().match(/(\d{1,2}\s+[A-Z][a-z]+ \d{4})/);
  if (dateMatch) doc.date_decided = dateMatch[1];
  
  // Judge/Ponente
  const ponenteMatch = $('.article-body').text().match(/(Ponente|Penned by|Written by):\s*([A-Z][a-z]+,\s*J\.?)/i);
  if (ponenteMatch) doc.judge = ponenteMatch[2];
  
  // Issues (numbered lists)
  $('.article-body ol, .article-body ul').each((i, el) => {
    const issues = $(el).find('li').slice(0, 5).map((_, li) => $(li).text().trim()).get();
    if (issues.some(issue => issue.toLowerCase().includes('issue'))) {
      doc.issues = issues;
    }
  });
  
  // Ruling (look for "WHEREFORE" or "DISPOSITIVE PORTION")
  const rulingMatch = $('.article-body').html().match(/<p[^>]*>WHEREFORE[^<]*<\/p>/i) || 
                     $('.article-body').html().match(/<p[^>]*DISPOSITIVE[^<]*<\/p>/i);
  if (rulingMatch) doc.ruling = cheerio('<div>' + rulingMatch[0] + '</div>').text().trim();
}

function parseChanRobles($, doc) {
  doc.title = $('h1, .casename').first().text().trim();
  
  // G.R. No. and date
  const headerMatch = $('h2, .head').first().text().match(/(G\.R\. No\..*?)\s+(\d{1,2}\s+[A-Z][a-z]+ \d{4})/i);
  if (headerMatch) {
    doc.title = headerMatch[1].trim();
    doc.date_decided = headerMatch[2].trim();
  }
  
  doc.judge = $('.ponente').text().trim() || $('h3').filter((i, el) => $(el).text().match(/J\.$/)).first().text().trim();
  
  // Issues & Ruling
  parseGeneric($, doc);
}

function parseSCJudiciary($, doc) {
  doc.title = $('.case_title').text().trim() || $('h1').first().text().trim();
  
  // Date from metadata
  doc.date_decided = $('.decision_date').text().trim() || $('meta[name="date"]').attr('content');
  
  doc.judge = $('.ponente_name').text().trim();
  
  // Structured sections
  $('.section').each((i, sec) => {
    const title = $(sec).find('h2, h3').first().text().toLowerCase();
    if (title.includes('issue')) {
      doc.issues.push($(sec).find('p').first().text().trim());
    } else if (title.includes('ruling') || title.includes('dispositive')) {
      doc.ruling = $(sec).text().trim();
    }
  });
}

function parseGeneric($, doc) {
  // Heuristic issue detection
  const paragraphs = $('.article-body p, .content p').toArray();
  
  paragraphs.forEach(p => {
    const text = $(p).text().trim();
    if (text.toLowerCase().startsWith('issue') || text.match(/^(w|w)h?hether/i)) {
      doc.issues.push(text);
    }
    if (text.toUpperCase().startsWith('WHEREFORE') || text.includes('dispositive portion')) {
      doc.ruling = text;
    }
  });
  
  // Cited laws (RA, Art, Sec patterns)
  const lawMatches = $('body').text().match(/(RA?\s+\d+|Art(?:icle)?\s+\d+|Sec(?:tion)?\s+\d+|Article\s+\d+|Section\s+\d+)/gi) || [];
  doc.cited_laws = [...new Set(lawMatches.slice(0, 20))];
}

function calculateConfidence(doc) {
  let score = 0.5;
  
  if (doc.title.length > 10) score += 0.1;
  if (doc.date_decided) score += 0.1;
  if (doc.judge) score += 0.1;
  if (doc.issues.length > 0) score += 0.15;
  if (doc.ruling) score += 0.15;
  
  return Math.min(score, 1);
}

// Handle pagination (if applicable)
async function extractLegalDocument(url) {
  // ... main logic above ...
  
  // Pagination check
  if ($('.pagination, .next-page').length) {
    const pages = [];
    $('.pagination a, .next-page').each((i, link) => {
      const href = $(link).attr('href');
      if (href && !href.includes('javascript')) pages.push(href);
    });
    
    if (pages.length > 1) {
      console.log(`Found ${pages.length} pages for ${url}`);
      // Sequential fetch for pagination
      for (const pageUrl of pages) {
        const pageDoc = await extractLegalDocument(pageUrl);
        doc.raw_content += '\n\n--- PAGE BREAK ---\n\n' + pageDoc.raw_content;
      }
    }
  }
  
  return doc;
}

module.exports = { extractLegalDocument };

/* Usage:
const { extractLegalDocument } = require('./extractLegalDocument');
const doc = await extractLegalDocument('https://lawphil.net/judjuris/juri2013/jun2013/gr_191752_2013.html');
console.log(JSON.stringify(doc, null, 2));
*/

