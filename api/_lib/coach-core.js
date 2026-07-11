const OpenAI = require("openai");

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

function readBody(req) {
  if (!req) {
    return {};
  }

  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (_error) {
      return {};
    }
  }

  return {};
}

function getHeader(req, key) {
  if (typeof req.get === "function") {
    return req.get(key);
  }

  if (req.headers && typeof req.headers === "object") {
    return req.headers[key.toLowerCase()] || req.headers[key];
  }

  return undefined;
}

function getClientId(req, body) {
  const headerId = safeString(getHeader(req, "x-device-id"), "");
  const bodyId = safeString(body && body.deviceId, "");
  const fallbackId = safeString(req.ip, "") || "unknown-device";

  return headerId || bodyId || fallbackId;
}

function getUsageRecord(dateKey, clientId) {
  const usageKey = `${dateKey}:${clientId}`;

  if (!usageByDay.has(usageKey)) {
    usageByDay.set(usageKey, { count: 0, updatedAt: new Date().toISOString() });
  }

  return usageByDay.get(usageKey);
}

function consumeDailyRequest(req, body) {
  const plan = normalizePlan(body && body.plan, body && body.subscriptionStatus);
  const dateKey = getDateKey();
  const clientId = getClientId(req, body);
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
    // Try brace extraction.
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

function sendJson(res, status, payload) {
  if (typeof res.status === "function") {
    return res.status(status).json(payload);
  }

  if (typeof res.json === "function") {
    res.statusCode = status;
    return res.json(payload);
  }

  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
  return undefined;
}

function methodNotAllowed(res) {
  return sendJson(res, 405, {
    error: "Method not allowed.",
    code: "method_not_allowed"
  });
}

function missingApiKeyResponse(res) {
  return sendJson(res, 500, {
    error: "OPENAI_API_KEY is not configured on the server.",
    code: "missing_api_key"
  });
}

function getOpenAIClient() {
  const apiKey = safeString(process.env.OPENAI_API_KEY, "");

  if (!apiKey) {
    return null;
  }

  return new OpenAI({ apiKey });
}

async function requestJsonFromOpenAI(openai, { prompt, jsonShapeHint, fallback }) {
  const candidateModels = ["gpt-4o-mini", "gpt-4.1-mini"];
  let lastError;

  for (const model of candidateModels) {
    try {
      const response = await openai.responses.create({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "You are a supportive, practical mindset coaching assistant. Return only valid JSON and no markdown."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
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
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function quotaFailure(res, quota) {
  return sendJson(res, 429, {
    error: "Daily AI request limit reached for your plan.",
    code: "daily_limit_reached",
    plan: quota.plan,
    used: quota.used,
    limit: quota.limit,
    remaining: quota.remaining
  });
}

function quotaSuccessPayload(quota, data) {
  return {
    ...data,
    plan: quota.plan,
    used: quota.used,
    limit: quota.limit,
    remaining: quota.remaining
  };
}

async function analyzeJournalHandler(req, res) {
  if (req.method && req.method !== "POST") {
    return methodNotAllowed(res);
  }

  const openai = getOpenAIClient();

  if (!openai) {
    return missingApiKeyResponse(res);
  }

  const body = readBody(req);
  const quota = consumeDailyRequest(req, body);

  if (!quota.ok) {
    return quotaFailure(res, quota);
  }

  const entry = safeString(body.entry, "");

  if (!entry) {
    return sendJson(res, 400, {
      error: "Journal entry is required.",
      code: "missing_entry"
    });
  }

  try {
    const result = await requestJsonFromOpenAI(openai, {
      prompt: `Analyze this journal entry and provide:\n\n1. Positive Observation\n2. Mindset Insight\n3. Small Action Step\n4. Encouraging Message\n\nJournal Entry:\n${entry}`,
      jsonShapeHint: '{"positiveObservation":"...","mindsetInsight":"...","smallActionStep":"...","encouragingMessage":"..."}',
      fallback: {
        positiveObservation: "You took time to reflect, which shows commitment to growth.",
        mindsetInsight: "Your words show you care deeply about improving your mindset.",
        smallActionStep: "Pick one kind thought to repeat to yourself today.",
        encouragingMessage: "You are building momentum one honest entry at a time."
      }
    });

    return sendJson(res, 200, quotaSuccessPayload(quota, result));
  } catch (error) {
    console.error("analyze-journal failed:", error && error.message ? error.message : error);
    return sendJson(res, 500, {
      error: "Could not analyze journal entry right now.",
      code: "openai_error"
    });
  }
}

async function goalCoachHandler(req, res) {
  if (req.method && req.method !== "POST") {
    return methodNotAllowed(res);
  }

  const openai = getOpenAIClient();

  if (!openai) {
    return missingApiKeyResponse(res);
  }

  const body = readBody(req);
  const quota = consumeDailyRequest(req, body);

  if (!quota.ok) {
    return quotaFailure(res, quota);
  }

  const goal = safeString(body.goal, "");

  if (!goal) {
    return sendJson(res, 400, {
      error: "Goal is required.",
      code: "missing_goal"
    });
  }

  try {
    const result = await requestJsonFromOpenAI(openai, {
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

    return sendJson(res, 200, quotaSuccessPayload(quota, result));
  } catch (error) {
    console.error("goal-coach failed:", error && error.message ? error.message : error);
    return sendJson(res, 500, {
      error: "Could not create a goal coaching plan right now.",
      code: "openai_error"
    });
  }
}

async function weeklyReportHandler(req, res) {
  if (req.method && req.method !== "POST") {
    return methodNotAllowed(res);
  }

  const openai = getOpenAIClient();

  if (!openai) {
    return missingApiKeyResponse(res);
  }

  const body = readBody(req);
  const quota = consumeDailyRequest(req, body);

  if (!quota.ok) {
    return quotaFailure(res, quota);
  }

  const summaryData = body.summaryData;

  if (!summaryData || typeof summaryData !== "object") {
    return sendJson(res, 400, {
      error: "summaryData is required.",
      code: "missing_summary_data"
    });
  }

  try {
    const result = await requestJsonFromOpenAI(openai, {
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

    return sendJson(res, 200, quotaSuccessPayload(quota, result));
  } catch (error) {
    console.error("weekly-report failed:", error && error.message ? error.message : error);
    return sendJson(res, 500, {
      error: "Could not generate weekly growth report right now.",
      code: "openai_error"
    });
  }
}

async function personalCoachHandler(req, res) {
  if (req.method && req.method !== "POST") {
    return methodNotAllowed(res);
  }

  const openai = getOpenAIClient();

  if (!openai) {
    return missingApiKeyResponse(res);
  }

  const body = readBody(req);
  const quota = consumeDailyRequest(req, body);

  if (!quota.ok) {
    return quotaFailure(res, quota);
  }

  const clientId = getClientId(req, body);
  const message = safeString(body.message, "");
  const context = body.context && typeof body.context === "object" ? body.context : {};

  if (!message) {
    return sendJson(res, 400, {
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

  const candidateModels = ["gpt-4o-mini", "gpt-4.1-mini"];

  try {
    let reply = "";
    let lastError;

    for (const model of candidateModels) {
      try {
        const response = await openai.responses.create({
          model,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: systemPrompt }]
            },
            {
              role: "user",
              content: [{ type: "input_text", text: userPrompt }]
            }
          ]
        });

        reply = safeString(response.output_text, "");

        if (reply) {
          break;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (!reply) {
      if (lastError) {
        throw lastError;
      }

      reply = "I am here for you. What is one small step you can take today?";
    }

    const updatedTurns = [...priorTurns, { user: message, assistant: reply, at: new Date().toISOString() }].slice(-20);
    coachMemoryByDevice.set(clientId, updatedTurns);

    return sendJson(res, 200, quotaSuccessPayload(quota, { reply }));
  } catch (error) {
    console.error("personal-coach failed:", error && error.message ? error.message : error);
    return sendJson(res, 500, {
      error: "Could not get a coach reply right now.",
      code: "openai_error"
    });
  }
}

async function healthHandler(_req, res) {
  const hasApiKey = Boolean(safeString(process.env.OPENAI_API_KEY, ""));
  return sendJson(res, 200, {
    ok: true,
    hasApiKey,
    date: getDateKey()
  });
}

module.exports = {
  planLimits,
  analyzeJournalHandler,
  goalCoachHandler,
  weeklyReportHandler,
  personalCoachHandler,
  healthHandler
};
