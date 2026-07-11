const { goalCoachHandler } = require("./_lib/coach-core");

module.exports = async function handler(req, res) {
  return goalCoachHandler(req, res);
};
