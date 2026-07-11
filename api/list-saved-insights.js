const { listSavedInsightsHandler } = require("./_lib/coach-core");

module.exports = async function handler(req, res) {
  return listSavedInsightsHandler(req, res);
};
