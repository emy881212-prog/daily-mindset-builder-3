const { analyzeJournalHandler } = require("./_lib/coach-core");

module.exports = async function handler(req, res) {
  return analyzeJournalHandler(req, res);
};
