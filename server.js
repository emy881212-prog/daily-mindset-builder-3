const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const {
  analyzeJournalHandler,
  goalCoachHandler,
  weeklyReportHandler,
  personalCoachHandler,
  healthHandler
} = require("./api/_lib/coach-core");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

app.get("/api/health", (req, res) => healthHandler(req, res));
app.post("/api/analyze-journal", (req, res) => analyzeJournalHandler(req, res));
app.post("/api/goal-coach", (req, res) => goalCoachHandler(req, res));
app.post("/api/weekly-report", (req, res) => weeklyReportHandler(req, res));
app.post("/api/personal-coach", (req, res) => personalCoachHandler(req, res));

app.listen(port, () => {
  console.log(`Daily Mindset Builder server running on port ${port}`);
});
