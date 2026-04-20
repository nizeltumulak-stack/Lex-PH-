const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Universal Philippine Legal Document Parser
 * Extracts structured data from any PH legal source URL
 */
async function readPhilippineLegalDocument(url) {
  try {
    console.log(`📄 Parsing legal document: ${url}`);
    
    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(html);
    const fullText = cleanContent($);

    // 1. Extract metadata using regex patterns
    const metadata = extractMetadata(fullText, url);

    // 2. Structure case/law components
    const document = {
      url,
      source_domain: new URL(url).hostname,
      title: metadata.title || $('h1, title').first().text().trim(),
      gr_number: metadata.grNumber,
      law_number: metadata.lawNumber,
      date_decided: metadata.dateDecided,
      date_enacted: metadata.dateEnacted,
      ponente: metadata.ponente,
      author: metadata.author,
      court_body: metadata.court || metadata.body,
      raw_full_text: fullText.substring(0, 50000), // 50K char limit
      word_count: fullText.split(/\s+/).length,
      extracted_at: new Date().toISOString(),
      parsing_confidence: metadata.confidence || 'medium'
    };

    // 3. Section-specific extraction
    const sections = parseSections(fullText);
    Object.assign(document, sections);

    // 4. Cited laws extraction
    document.cited_laws = extractCitedLaws(fullText);

    console.log(`✅ Document parsed: ${document.title.substring(0, 60)}... (${document.word_count} words)`);
    return document;

  } catch (error) {
    console.error(`❌ Document parsing failed [${url}]:`, error.message);
    return {
      url,
      error: error.message,
      source_domain: new URL(url).hostname,
      parsing_confidence: 'failed'
    };
  }
}

/**
 * Clean HTML - remove ads, nav, boilerplate
 */
function cleanContent($) {
  // Remove common junk
  const junkSelectors = [
    'nav', 'header', 'footer', 'aside', '.ad', '.advertisement',
    '[class*="ad"]', '[class*="sidebar"]', '[id*="footer"]',
    'script', 'style', '.navbar', '.breadcrumb'
  ];
  
  junkSelectors.forEach(selector => $(selector).remove());

  // Main content selectors (prioritized)
  const contentSelectors = [
    'article', '.entry-content', '.post-content',
    '.main-content', '[role="main"]', '.content'
  ];

  let content = '';
  for (const selector of contentSelectors) {
    const $content = $(selector);
    if ($content.length) {
      content = $content.text();
      if (content.length > 1000) break;
    }
  }

  // Fallback: body text
  if (content.length < 500) {
    content = $('body').text();
  }

  return content
    .replace(/\\s+/g, ' ')
    .replace(/[\\n\\r]+/g, ' ')
    .trim();
}

/**
 * Extract structured metadata with regex
 */
function extractMetadata(text, url) {
  const confidence = [];
  
  // GR Numbers
  const grMatch = text.match(/(G\.R\. No\..*?)(?=\\s[G]\.|\\d{4}|Ponente|En Banc|$)/i);
  const grNumber = grMatch ? grMatch[1].trim() : null;
  if (grNumber) confidence.push('gr');

  // Law numbers
  const lawMatch = text.match(/(RA?|PD?|EO?|Republic Act|Presidential Decree) No?\.?.*?\\d+[A-Z]?/i);
  const lawNumber = lawMatch ? lawMatch[1].trim() : null;
  if (lawNumber) confidence.push('law');

  // Dates
  const dateMatches = text.matchAll(/(\\d{1,2} [A-Za-z]+ \\d{4}|[A-Za-z]+ \\d+, \\d{4}|\\d{4}-\\d{2}-\\d{2})/g);
  const dates = Array.from(dateMatches).map(m => m[1]);
  const dateDecided = dates[0] || null;
  const dateEnacted = dates[1] || null;

  // Ponente/Author
  const ponenteMatch = text.match(/(ponente|Penned by|authored by)[:\\s]+([A-Z][a-z]+, J\\.?)/i);
  const ponente = ponenteMatch ? ponenteMatch[2].trim() : null;

  // Court/Body
  const courtMatch = text.match(/(supreme court|court of appeals|rtc|sac|rca|(?:first|second|third) division|en banc)/i);
  const court = courtMatch ? courtMatch[1].toUpperCase() : null;

  return {
    grNumber,
    lawNumber,
    dateDecided,
    dateEnacted,
    ponente,
    court,
    author: ponente,
    body: court,
    confidence: confidence.length
  };
}

/**
 * Parse case sections by keywords
 */
function parseSections(fullText) {
  const sections = {};
  
  const sectionPatterns = {
    facts: /(facts|antecedents|background|foregoing facts?|statement of facts)/i,
    issues: /(issues?|matters? raised|errors? assigned|questions? presented)/i,
    ruling: /(ruling|disposition|held|ratio decidendi|wherefore)/i,
    fallo: /(wherefore|dispositive|ordered|fallo|it is hereby)/i
  };

  for (const [key, pattern] of Object.entries(sectionPatterns)) {
    const match = fullText.match(pattern);
    if (match) {
      const start = match.index + match[0].length;
      const sectionText = fullText.substring(start, start + 2000)
        .split(/\\n+|\\.\\s*[A-Z]|\\d+\\.\\s*/)[0]
        .trim()
        .substring(0, 1000);
      
      sections[key] = sectionText;
    }
  }

  return sections;
}

/**
 * Extract cited laws/articles
 */
function extractCitedLaws(text) {
  const lawMatches = [
    ...text.matchAll(/(Article|Section|Rule)\\s+(\\d+[A-Z]?)(?:\\s+of)?\\s+([^\\.]+)/gi),
    ...text.matchAll(/(RA?|PD?|EO?)\\s+(No\\.)?\\s*(\\d+[A-Z]?)/gi)
  ];

  return Array.from(new Set(
    lawMatches.map(match => 
      `${match[1]} ${match[2]} ${match[3] || ''}`.trim()
    ).filter(Boolean)
  )).slice(0, 20);
}

module.exports = { readPhilippineLegalDocument };

// Test usage:
// const { readPhilippineLegalDocument } = require('./readPhilippineLegalDocument');
// readPhilippineLegalDocument('https://sc.judiciary.gov.ph/...').then(console.log)

