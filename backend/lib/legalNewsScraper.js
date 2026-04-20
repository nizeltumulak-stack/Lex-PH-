const axios = require('axios');
const cheerio = require('cheerio');
const { parse } = require('rss-parser');

/**
 * LexPH Legal News Aggregator
 * SC decisions, admin orders, MCLE, circulars, amendments
 */

class LegalNewsScraper {
  constructor() {
    this.parser
