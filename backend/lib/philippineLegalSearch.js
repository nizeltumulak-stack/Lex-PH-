const { search: scSearch } = require('./scJudiciaryScraper');
const { search: lawphilSearch } = require('./lawphilScraper');
const { search: chanroblesSearch } = require('./chanroblesScraper');
const { search: gazetteSearch } = require('./officialGazetteScraper');
const { search: senateSearch } = require('./senateScraper');

/**
 * Philippine Legal Search Aggregator
 * Scrapes 5 sources simultaneously, dedupes, ranks, returns top 15
 */
async function philippineLegalSearch(query) {
  console.log(`\n🎯 PHILIPPINE LEGAL SEARCH: "${query}"`);
  const startTime = Date.now();

  try {
    // 1. Parallel scraping (all 5 sources)
    const scraperPromises = [
      scSearch(query).then(r => ({ source: 'SC E-Library', results: r })),
      lawphilSearch(query).then(r => ({ source: 'LawPhil', results: r })),
      chanroblesSearch(query).then(r => ({ source: 'ChanRobles', results: r })),
      gazetteSearch(query).then(r => ({ source: 'Official Gazette', results: r })),
      senateSearch(query).then(r => ({ source: 'Senate.gov.ph', results: r }))
    ];

    const sources = await Promise.allSettled(scraperPromises);
    const allRawResults = sources
      .filter(s => s.status === 'fulfilled')
      .flatMap(s => s.value.results.map(result => ({ ...result, source: s.value.source })));

    console.log(`📊 Raw: ${allRawResults.length} results from ${sources.filter(s => s.status === 'fulfilled').length}/5 sources`);

    // 2. Deduplicate by GR/law number + title similarity
    const uniqueResults = deduplicateResults(allRawResults);
    console.log(`🧹 Deduped: ${uniqueResults.length} unique`);

    // 3. Rank by court hierarchy + recency + keyword match
    const rankedResults = rankResults(uniqueResults, query);
    
    // 4. Top 15 structured results
    const finalResults = rankedResults.slice(0, 15).map((result, index) => ({
      rank: index + 1,
      score: result.finalScore,
      title: result.title,
      gr_number: result.gr_number || result.document_number,
      date_decided: result.date_decided || result.date || result.date_signed,
      ponente: result.ponente,
      category: result.category || result.document_type,
      excerpt: result.excerpt || result.snippet,
      url: result.url,
      source: result.source,
      relevance_factors: {
        court_boost: result.courtBoost,
        recency_boost: result.recencyBoost, 
        keyword_match: result.keywordScore
      }
    }));

    const duration = Math.round(Date.now() - startTime);
    console.log(`🏆 Top ${finalResults.length} results in ${duration}ms`);

    return {
      query,
      total_raw: allRawResults.length,
      unique_count: uniqueResults.length,
      top_results: finalResults,
      sources_scanned: sources.filter(s => s.status === 'fulfilled').map(s => s.value.source),
      processing_time_ms: duration,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Philippine Legal Search failed:', error);
    return {
      query,
      error: error.message,
      top_results: [],
      processing_time_ms: 0
    };
  }
}

function deduplicateResults(results) {
  const seen = new Set();
  return results.filter(result => {
    // Normalize identifiers
    const identifiers = [
      result.gr_number?.toLowerCase().trim(),
      result.document_number?.toLowerCase().trim(),
      `${result.title?.substring(0, 50).toLowerCase().trim()} ${result.source}`
    ].filter(Boolean);

    const key = identifiers.join('|');
    
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankResults(results, query) {
  const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const now = new Date();

  return results.map(result => {
    let score = 0;

    // 1. Keyword relevance (40%)
    const keywordMatches = queryWords.filter(word => 
      (result.title?.toLowerCase() || '').includes(word) ||
      (result.excerpt?.toLowerCase() || '').includes(word)
    ).length;
    const keywordScore = (keywordMatches / queryWords.length) * 40;
    
    // 2. Court hierarchy (30%) 
    const courtBoost = {
      'supreme court': 30,
      'sc e-library': 25,
      'court of appeals': 20,
      'official gazette': 15,
      'lawphil': 10,
      'chanrobles': 8,
      'senate': 5
    };
    const courtBoostScore = courtBoost[result.source?.toLowerCase()] || 0;

    // 3. Recency (20%)
    const dateStr = result.date_decided || result.date || result.date_signed;
    let recencyBoost = 0;
    if (dateStr) {
      try {
        const docDate = new Date(dateStr);
        const ageDays = (now - docDate) / (1000 * 60 * 60 * 24);
        if (ageDays < 365) recencyBoost = 20;
        else if (ageDays < 1825) recencyBoost = 10; // <5 years
        else recencyBoost = 5;
      } catch {}
    }

    // 4. Source diversity bonus (10%)
    const diversityBonus = results.some(r => r.source === result.source) ? 2 : 5;

    const finalScore = Math.round(keywordScore + courtBoostScore + recencyBoost + diversityBonus);

    return {
      ...result,
      finalScore,
      keywordScore,
      courtBoost: courtBoostScore,
      recencyBoost,
      keywordMatches: keywordMatches
    };
  }).sort((a, b) => b.finalScore - a.finalScore);
}

module.exports = { philippineLegalSearch };

// Test harness
// node -e "
//   const { philippineLegalSearch } = require('./philippineLegalSearch');
//   philippineLegalSearch('illegal dismissal due process')
//     .then(console.log)
//     .catch(console.error)
// "

