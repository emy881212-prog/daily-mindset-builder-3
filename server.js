const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const {
  analyzeJournalHandler,
  goalCoachHandler,
  weeklyReportHandler,
  personalCoachHandler,
  healthHandler,
  saveInsightHandler,
  listSavedInsightsHandler,
  deleteSavedInsightHandler
} = require("./api/_lib/coach-core");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

app.get("/menu", (req, res) => {
  res.sendFile(path.join(__dirname, "menu.html"));
});

app.get("/settings", (req, res) => {
  res.sendFile(path.join(__dirname, "settings.html"));
});

app.get("/api/health", (req, res) => healthHandler(req, res));
app.post("/api/analyze-journal", (req, res) => analyzeJournalHandler(req, res));
app.post("/api/goal-coach", (req, res) => goalCoachHandler(req, res));
app.post("/api/weekly-report", (req, res) => weeklyReportHandler(req, res));
app.post("/api/personal-coach", (req, res) => personalCoachHandler(req, res));
app.post("/api/save-insight", (req, res) => saveInsightHandler(req, res));
app.get("/api/list-saved-insights", (req, res) => listSavedInsightsHandler(req, res));
app.post("/api/list-saved-insights", (req, res) => listSavedInsightsHandler(req, res));
app.post("/api/delete-saved-insight", (req, res) => deleteSavedInsightHandler(req, res));

app.listen(port, () => {
  console.log(`Daily Mindset Builder server running on port ${port}`);
});
