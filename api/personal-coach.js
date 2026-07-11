const { personalCoachHandler } = require("./_lib/coach-core");

module.exports = async function handler(req, res) {
  return personalCoachHandler(req, res);
};
