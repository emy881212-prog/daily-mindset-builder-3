const { weeklyReportHandler } = require("./_lib/coach-core");

module.exports = async function handler(req, res) {
  return weeklyReportHandler(req, res);
};
