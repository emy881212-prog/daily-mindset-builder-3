const { healthHandler } = require("./_lib/coach-core");

module.exports = async function handler(req, res) {
  return healthHandler(req, res);
};
