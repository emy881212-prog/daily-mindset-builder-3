const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

const planLimits = {
  free: 3,
  standard: 30,
  premium: 100,
  pro: Infinity
};

const usageByDay = new Map();
const coachMemoryByDevice = new Map();

function getDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function safeString(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value).trim() || fallback;
}

function normalizePlan(rawPlan, legacyPaidFlag) {
  const normalized = safeString(rawPlan, "").toLowerCase();

  if (["free", "standard", "premium", "pro"].includes(normalized)) {
    return normalized;
  }

  if (legacyPaidFlag === true || safeString(legacyPaidFlag, "") === "paid") {
    return "premium";
  }

  return "free";
}

function getClientId(req) {
  const headerId = safeString(req.get("x-device-id"), "");
  const bodyId = safeString(req.body && req.body.deviceId, "");
  const fallbackId = req.ip || "unknown-device";

  return headerId || bodyId || fallbackId;
}

function getUsageRecord(dateKey, clientId) {
  const usageKey = `${dateKey}:${clientId}`;

  if (!usageByDay.has(usageKey)) {
    usageByDay.set(usageKey, { count: 0, updatedAt: new Date().toISOString() });
  }

  return usageByDay.get(usageKey);
}

function consumeDailyRequest(req) {
  const plan = normalizePlan(req.body && req.body.plan, req.body && req.body.subscriptionStatus);
  const dateKey = getDateKey();
  const clientId = getClientId(req);
  const limit = planLimits[plan] || planLimits.free;

  if (limit === Infinity) {
    return {
      ok: true,
      plan,
      remaining: Infinity,
      used: 0,
      limit,
      dateKey,
      clientId
    };
  }

  const usage = getUsageRecord(dateKey, clientId);

  if (usage.count >= limit) {
    return {
      ok: false,
      plan,
      remaining: 0,
      used: usage.count,
      limit,
      dateKey,
      clientId
    };
  }

  usage.count += 1;
  usage.updatedAt = new Date().toISOString();

  return {
    ok: true,
    plan,
    remaining: Math.max(0, limit - usage.count),
    used: usage.count,
    limit,
    dateKey,
    clientId
  };
}

function extractFirstJsonObject(rawText) {
  const content = safeString(rawText, "");

  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (_error) {
    // Continue and attempt object extraction.
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const objectText = content.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(objectText);
  } catch (_error) {
    return null;
  }
}

function missingApiKeyResponse(res) {
  return res.status(500).json({
    error: "OPENAI_API_KEY is not configured on the server.",
    code: "missing_api_key"
  });
}

const apiKey = safeString(process.env.OPENAI_API_KEY, "");
const openai = apiKey ? new OpenAI({ apiKey }) : null;

async function requestJsonFromOpenAI({ prompt, jsonShapeHint, fallback, model = "gpt-4.1-mini" }) {
  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "text",
            text: "You are a supportive, practical mindset coaching assistant. Return only valid JSON and no markdown."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${prompt}\n\nReturn JSON with this exact shape:\n${jsonShapeHint}`
          }
        ]
      }
    ]
  });

  const outputText = safeString(response.output_text, "");
  const parsed = extractFirstJsonObject(outputText);

  if (!parsed || typeof parsed !== "object") {
    return fallback;
  }

  return { ...fallback, ...parsed };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(apiKey),
    date: getDateKey()
  });
});

app.post("/api/analyze-journal", async (req, res) => {
  if (!openai) {
    return missingApiKeyResponse(res);
  }

  const quota = consumeDailyRequest(req);

  if (!quota.ok) {
    return res.status(429).json({
      error: "Daily AI request limit reached for your plan.",
      code: "daily_limit_reached",
      plan: quota.plan,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining
    });
  }

  const entry = safeString(req.body && req.body.entry, "");

  if (!entry) {
    return res.status(400).json({
      error: "Journal entry is required.",
      code: "missing_entry"
    });
  }

  try {
    const result = await requestJsonFromOpenAI({
      prompt: `Analyze this journal entry and provide:\n\n1. Positive Observation\n2. Mindset Insight\n3. Small Action Step\n4. Encouraging Message\n\nJournal Entry:\n${entry}`,
      jsonShapeHint: '{"positiveObservation":"...","mindsetInsight":"...","smallActionStep":"...","encouragingMessage":"..."}',
      fallback: {
        positiveObservation: "You took time to reflect, which shows commitment to growth.",
        mindsetInsight: "Your words show you care deeply about improving your mindset.",
        smallActionStep: "Pick one kind thought to repeat to yourself today.",
        encouragingMessage: "You are building momentum one honest entry at a time."
      }
    });

    return res.json({
      ...result,
      plan: quota.plan,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining
    });
  } catch (error) {
    console.error("analyze-journal failed:", error);
    return res.status(500).json({
      error: "Could not analyze journal entry right now.",
      code: "openai_error"
    });
  }
});

app.post("/api/goal-coach", async (req, res) => {
  if (!openai) {
    return missingApiKeyResponse(res);
  }

  const quota = consumeDailyRequest(req);

  if (!quota.ok) {
    return res.status(429).json({
      error: "Daily AI request limit reached for your plan.",
      code: "daily_limit_reached",
      plan: quota.plan,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining
    });
  }

  const goal = safeString(req.body && req.body.goal, "");

  if (!goal) {
    return res.status(400).json({
      error: "Goal is required.",
      code: "missing_goal"
    });
  }

  try {
    const result = await requestJsonFromOpenAI({
      prompt: `Create:\n\n1. Weekly Plan\n2. Small Milestones\n3. Motivational Reminder\n4. Progress Check-In Question\n\nGoal:\n${goal}`,
      jsonShapeHint: '{"weeklyPlan":"...","smallMilestones":["..."],"motivationalReminder":"...","progressCheckInQuestion":"..."}',
      fallback: {
        weeklyPlan: "Break this goal into 3 short work sessions this week.",
        smallMilestones: ["Define success clearly", "Take the first action", "Review progress at week end"],
        motivationalReminder: "Consistent small steps are stronger than perfect plans.",
        progressCheckInQuestion: "What is one concrete sign that you moved forward today?"
      }
    });

    if (!Array.isArray(result.smallMilestones)) {
      result.smallMilestones = [String(result.smallMilestones || "Set one small milestone.")];
    }

    return res.json({
      ...result,
      plan: quota.plan,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining
    });
  } catch (error) {
    console.error("goal-coach failed:", error);
    return res.status(500).json({
      error: "Could not create a goal coaching plan right now.",
      code: "openai_error"
    });
  }
});

app.post("/api/weekly-report", async (req, res) => {
  if (!openai) {
    return missingApiKeyResponse(res);
  }

  const quota = consumeDailyRequest(req);

  if (!quota.ok) {
    return res.status(429).json({
      error: "Daily AI request limit reached for your plan.",
      code: "daily_limit_reached",
      plan: quota.plan,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining
    });
  }

  const summaryData = req.body && req.body.summaryData;

  if (!summaryData || typeof summaryData !== "object") {
    return res.status(400).json({
      error: "summaryData is required.",
      code: "missing_summary_data"
    });
  }

  try {
    const result = await requestJsonFromOpenAI({
      prompt: `Analyze this weekly personal data and return:\n\n1. Main Strength\n2. Growth Area\n3. Mood Trend\n4. Achievement Summary\n5. Focus For Next Week\n6. Encouraging Message\n\nData:\n${JSON.stringify(summaryData, null, 2)}`,
      jsonShapeHint: '{"mainStrength":"...","growthArea":"...","moodTrend":"...","achievementSummary":"...","focusForNextWeek":"...","encouragingMessage":"..."}',
      fallback: {
        mainStrength: "You are showing consistency by checking in with yourself.",
        growthArea: "Turn reflection into one concrete daily action.",
        moodTrend: "Your mood patterns suggest progress when routines stay simple.",
        achievementSummary: "You captured meaningful wins and emotional awareness this week.",
        focusForNextWeek: "Choose one repeatable habit and protect time for it.",
        encouragingMessage: "Growth is happening even when it feels gradual. Keep going."
      }
    });

    return res.json({
      ...result,
      plan: quota.plan,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining
    });
  } catch (error) {
    console.error("weekly-report failed:", error);
    return res.status(500).json({
      error: "Could not generate weekly growth report right now.",
      code: "openai_error"
    });
  }
});

app.post("/api/personal-coach", async (req, res) => {
  if (!openai) {
    return missingApiKeyResponse(res);
  }

  const quota = consumeDailyRequest(req);

  if (!quota.ok) {
    return res.status(429).json({
      error: "Daily AI request limit reached for your plan.",
      code: "daily_limit_reached",
      plan: quota.plan,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining
    });
  }

  const clientId = getClientId(req);
  const message = safeString(req.body && req.body.message, "");
  const context = req.body && req.body.context && typeof req.body.context === "object"
    ? req.body.context
    : {};

  if (!message) {
    return res.status(400).json({
      error: "Chat message is required.",
      code: "missing_message"
    });
  }

  const priorTurns = coachMemoryByDevice.get(clientId) || [];
  const compactHistory = priorTurns.slice(-8).map((turn) => {
    const user = safeString(turn.user, "");
    const assistant = safeString(turn.assistant, "");
    return `User: ${user}\nCoach: ${assistant}`;
  }).join("\n\n");

  const systemPrompt = [
    "You are a supportive personal mindset coach.",
    "Use user goals, mood tracker history, journal entries, gratitude journal, weekly growth reports, and questionnaire results when available.",
    "Provide personalized coaching, encouragement, accountability, action steps, and growth recommendations.",
    "Keep tone warm, clear, and practical.",
    "When useful, end with one concrete next action and one reflective question."
  ].join(" ");

  const userPrompt = [
    "Context data:",
    JSON.stringify(context, null, 2),
    "Conversation memory (if any):",
    compactHistory || "No previous conversation memory.",
    "New user message:",
    message
  ].join("\n\n");

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [{ type: "text", text: systemPrompt }]
        },
        {
          role: "user",
          content: [{ type: "text", text: userPrompt }]
        }
      ]
    });

    const reply = safeString(response.output_text, "I am here for you. What is one small step you can take today?");

    const updatedTurns = [...priorTurns, { user: message, assistant: reply, at: new Date().toISOString() }].slice(-20);
    coachMemoryByDevice.set(clientId, updatedTurns);

    return res.json({
      reply,
      plan: quota.plan,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining
    });
  } catch (error) {
    console.error("personal-coach failed:", error);
    return res.status(500).json({
      error: "Could not get a coach reply right now.",
      code: "openai_error"
    });
  }
});

app.listen(port, () => {
  console.log(`Daily Mindset Builder server running on port ${port}`);
});
