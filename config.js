// ============================================================
//  MILESX9 — External API Config
//  Add your own API keys here, or leave blank to disable
//  features that depend on them.
// ============================================================

require('dotenv').config();

const APIs = {
  // Add your own API endpoints here if needed
};

const APIKeys = {
  // Add your own API keys here
  // Example:
  // 'https://api.example.com': process.env.EXAMPLE_API_KEY || '',
};

module.exports = {
  WARN_COUNT: 3,
  APIs,
  APIKeys,
};
