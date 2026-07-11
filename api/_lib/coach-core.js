const OpenAI = require("openai");
const {
  readUsageState,
  writeUsageState,
  isDurableStoreConfigured
} = require("./durable-usage-store");
const {
  readSavedInsights,
  writeSavedInsights,
  isInsightsStoreConfigured,
  MAX_INSIGHTS_PER_USER
} = require("./durable-insights-store");

const planLimits = {
  free: 3,
  standard: 30,
  premium: 100,
  premium_plus: 300,
  pro: Infinity
};

const FREE_TOTAL_LIMIT = 3;
const PRO_FAIR_USE_DAILY_LIMIT = 300;
const PRO_FAIR_USE_MONTHLY_LIMIT = 10000;
const coachMemoryByDevice = new Map();

function getDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function getMonthKey() {
  return new Date().toISOString().slice(0, 7);
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
  const mapped = normalized === "premium plus" || normalized === "premiumplus" || normalized === "premium+"
    ? "premium_plus"
    : normalized;

  if (["free", "standard", "premium", "premium_plus", "pro"].includes(mapped)) {
    return mapped;
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

function normalizeUserId(rawUserId) {
  return safeString(rawUserId, "").toLowerCase();
}

function getAuthenticatedUserId(req, body) {
  const headerUserId = normalizeUserId(getHeader(req, "x-user-id"));
  const bodyUserId = normalizeUserId(body && body.userId);

  return headerUserId || bodyUserId;
}

function authRequiredPayload() {
  return {
    error: "Authentication required. Please sign in to use AI coaching.",
    code: "auth_required"
  };
}

function durableStoreUnavailablePayload() {
  return {
    error: "Durable usage store is not configured.",
    code: "durable_store_not_configured"
  };
}

function lockResponsePayload({ plan, used, limit, code, error, upgradeMessage }) {
  const remaining = Number.isFinite(limit)
    ? Math.max(0, limit - used)
    : Infinity;

  return {
    error,
    code,
    plan,
    used,
    limit,
    remaining,
    locked: true,
    upgradeMessage: upgradeMessage || ""
  };
}

function getMonthlyCount(usageState, monthKey, plan) {
  const monthly = usageState.monthly && typeof usageState.monthly === "object"
    ? usageState.monthly
    : {};
  const monthEntry = monthly[monthKey] && typeof monthly[monthKey] === "object"
    ? monthly[monthKey]
    : {};
  const raw = Number(monthEntry[plan] || 0);

  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function getFairUseDailyCount(usageState, dateKey) {
  const raw = Number(usageState.fairUseDaily && usageState.fairUseDaily[dateKey]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function getFairUseMonthlyCount(usageState, monthKey) {
  const raw = Number(usageState.fairUseMonthly && usageState.fairUseMonthly[monthKey]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function evaluatePlanLimit({ plan, usageState, dateKey, monthKey }) {
  if (plan === "free") {
    const used = Number.isFinite(Number(usageState.freeTotal)) && Number(usageState.freeTotal) > 0
      ? Math.floor(Number(usageState.freeTotal))
      : 0;
    const limit = FREE_TOTAL_LIMIT;
    const blocked = used >= limit;

    return {
      blocked,
      code: blocked ? "free_ai_limit_reached" : "",
      error: "You have used all 3 free AI coaching sessions.",
      upgradeMessage: "You have used all 3 free AI coaching sessions. Upgrade to unlock unlimited AI coaching, personalized guidance, advanced insights, weekly reports, and premium features.",
      used,
      limit
    };
  }

  if (plan === "standard" || plan === "premium" || plan === "premium_plus") {
    const limit = planLimits[plan];
    const used = getMonthlyCount(usageState, monthKey, plan);
    const blocked = used >= limit;

    return {
      blocked,
      code: blocked ? "monthly_limit_reached" : "",
      error: "You have reached your monthly AI request limit for this plan.",
      upgradeMessage: blocked ? "Upgrade your plan to continue AI coaching this month." : "",
      used,
      limit
    };
  }

  if (plan === "pro") {
    const usedDaily = getFairUseDailyCount(usageState, dateKey);
    const usedMonthly = getFairUseMonthlyCount(usageState, monthKey);
    const blocked = usedDaily >= PRO_FAIR_USE_DAILY_LIMIT || usedMonthly >= PRO_FAIR_USE_MONTHLY_LIMIT;

    return {
      blocked,
      code: blocked ? "fair_use_limit_reached" : "",
      error: "You have reached our fair-use limit. Please contact support if you need additional usage.",
      upgradeMessage: "",
      used: Math.max(usedDaily, usedMonthly),
      limit: Infinity
    };
  }

  return {
    blocked: false,
    code: "",
    error: "",
    upgradeMessage: "",
    used: 0,
    limit: Infinity
  };
}

function applyUsageIncrement({ plan, usageState, dateKey, monthKey }) {
  const next = usageState && typeof usageState === "object" ? usageState : {};
  next.monthly = next.monthly && typeof next.monthly === "object" ? next.monthly : {};
  next.fairUseDaily = next.fairUseDaily && typeof next.fairUseDaily === "object" ? next.fairUseDaily : {};
  next.fairUseMonthly = next.fairUseMonthly && typeof next.fairUseMonthly === "object" ? next.fairUseMonthly : {};

  if (plan === "free") {
    const current = Number(next.freeTotal || 0);
    next.freeTotal = Number.isFinite(current) ? Math.max(0, Math.floor(current)) + 1 : 1;
    return next;
  }

  if (plan === "standard" || plan === "premium" || plan === "premium_plus") {
    const monthEntry = next.monthly[monthKey] && typeof next.monthly[monthKey] === "object"
      ? next.monthly[monthKey]
      : {};
    const current = Number(monthEntry[plan] || 0);
    monthEntry[plan] = Number.isFinite(current) ? Math.max(0, Math.floor(current)) + 1 : 1;
    next.monthly[monthKey] = monthEntry;
    return next;
  }

  if (plan === "pro") {
    const currentDaily = Number(next.fairUseDaily[dateKey] || 0);
    const currentMonthly = Number(next.fairUseMonthly[monthKey] || 0);
    next.fairUseDaily[dateKey] = Number.isFinite(currentDaily) ? Math.max(0, Math.floor(currentDaily)) + 1 : 1;
    next.fairUseMonthly[monthKey] = Number.isFinite(currentMonthly) ? Math.max(0, Math.floor(currentMonthly)) + 1 : 1;
    return next;
  }

  return next;
}

function usageSummary({ plan, usageState, dateKey, monthKey }) {
  if (plan === "free") {
    const used = Number.isFinite(Number(usageState.freeTotal)) && Number(usageState.freeTotal) > 0
      ? Math.floor(Number(usageState.freeTotal))
      : 0;

    return {
      used,
      limit: FREE_TOTAL_LIMIT,
      remaining: Math.max(0, FREE_TOTAL_LIMIT - used)
    };
  }

  if (plan === "standard" || plan === "premium" || plan === "premium_plus") {
    const used = getMonthlyCount(usageState, monthKey, plan);
    const limit = planLimits[plan];

    return {
      used,
      limit,
      remaining: Math.max(0, limit - used)
    };
  }

  if (plan === "pro") {
    return {
      used: 0,
      limit: Infinity,
      remaining: Infinity
    };
  }

  return {
    used: 0,
    limit: Infinity,
    remaining: Infinity
  };
}

function createInsightId(userId) {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `ins-${Date.now()}-${randomPart}-${safeString(userId, "user")}`;
}

function insightsStoreUnavailablePayload() {
  return {
    error: "Durable saved-insights store is not configured.",
    code: "saved_insights_store_not_configured"
  };
}

function normalizeFeatureType(rawType) {
  const normalized = safeString(rawType, "").toLowerCase();
  const map = {
    analyze_journal: "Analyze Journal Entry",
    goal_coach: "Goal Coach",
    weekly_growth_report: "Weekly Growth Report",
    personal_ai_coach: "Personal AI Coach"
  };

  return map[normalized] || "Personal AI Coach";
}

function normalizeResponseContent(rawContent) {
  return safeString(rawContent, "").slice(0, 10000);
}

function getSearchQuery(req, body) {
  const queryFromBody = safeString(body && body.query, "");
  if (queryFromBody) {
    return queryFromBody.toLowerCase();
  }

  const queryFromReq = safeString(req && req.query && req.query.q, "");
  return queryFromReq.toLowerCase();
}

async function saveInsightHandler(req, res) {
  if (req.method && req.method !== "POST") {
    return methodNotAllowed(res);
  }

  if (!isInsightsStoreConfigured()) {
    return sendJson(res, 500, insightsStoreUnavailablePayload());
  }

  const body = readBody(req);
  const userId = getAuthenticatedUserId(req, body);

  if (!userId) {
    return sendJson(res, 401, authRequiredPayload());
  }

  const featureType = normalizeFeatureType(body && body.featureType);
  const responseContent = normalizeResponseContent(body && body.responseContent);

  if (!responseContent) {
    return sendJson(res, 400, {
      error: "responseContent is required.",
      code: "missing_response_content"
    });
  }

  try {
    const currentEntries = await readSavedInsights(userId);
    const newEntry = {
      id: createInsightId(userId),
      userId,
      featureType,
      responseContent,
      createdAt: new Date().toISOString()
    };

    const nextEntries = [newEntry, ...currentEntries].slice(0, MAX_INSIGHTS_PER_USER);
    await writeSavedInsights(userId, nextEntries);

    return sendJson(res, 200, {
      ok: true,
      message: "✅ Saved successfully",
      entry: newEntry
    });
  } catch (error) {
    console.error("save-insight failed:", error && error.message ? error.message : error);
    return sendJson(res, 500, {
      error: "Could not save insight right now.",
      code: "save_insight_error"
    });
  }
}

async function listSavedInsightsHandler(req, res) {
  const method = safeString(req && req.method, "GET").toUpperCase();

  if (method !== "GET" && method !== "POST") {
    return methodNotAllowed(res);
  }

  if (!isInsightsStoreConfigured()) {
    return sendJson(res, 500, insightsStoreUnavailablePayload());
  }

  const body = readBody(req);
  const userId = getAuthenticatedUserId(req, body);

  if (!userId) {
    return sendJson(res, 401, authRequiredPayload());
  }

  const query = getSearchQuery(req, body);

  try {
    const entries = await readSavedInsights(userId);
    const filtered = query
      ? entries.filter((entry) => {
        const haystack = `${entry.featureType}\n${entry.responseContent}`.toLowerCase();
        return haystack.includes(query);
      })
      : entries;

    return sendJson(res, 200, {
      ok: true,
      entries: filtered
    });
  } catch (error) {
    console.error("list-saved-insights failed:", error && error.message ? error.message : error);
    return sendJson(res, 500, {
      error: "Could not load saved insights right now.",
      code: "list_saved_insights_error"
    });
  }
}

async function deleteSavedInsightHandler(req, res) {
  if (req.method && req.method !== "POST" && req.method !== "DELETE") {
    return methodNotAllowed(res);
  }

  if (!isInsightsStoreConfigured()) {
    return sendJson(res, 500, insightsStoreUnavailablePayload());
  }

  const body = readBody(req);
  const userId = getAuthenticatedUserId(req, body);

  if (!userId) {
    return sendJson(res, 401, authRequiredPayload());
  }

  const entryId = safeString(body && body.id, "");

  if (!entryId) {
    return sendJson(res, 400, {
      error: "id is required.",
      code: "missing_saved_entry_id"
    });
  }

  try {
    const entries = await readSavedInsights(userId);
    const nextEntries = entries.filter((entry) => entry.id !== entryId);
    await writeSavedInsights(userId, nextEntries);

    return sendJson(res, 200, {
      ok: true,
      deleted: entries.length !== nextEntries.length,
      id: entryId
    });
  } catch (error) {
    console.error("delete-saved-insight failed:", error && error.message ? error.message : error);
    return sendJson(res, 500, {
      error: "Could not delete saved insight right now.",
      code: "delete_saved_insight_error"
    });
  }
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

function durableStoreErrorPayload(message) {
  return {
    error: message || "Durable usage store request failed.",
    code: "durable_store_error"
  };
}

async function getUsageAccessOrRespond(req, res, body) {
  if (!isDurableStoreConfigured()) {
    sendJson(res, 500, durableStoreUnavailablePayload());
    return null;
  }

  const userId = getAuthenticatedUserId(req, body);

  if (!userId) {
    sendJson(res, 401, authRequiredPayload());
    return null;
  }

  const plan = normalizePlan(body && body.plan, body && body.subscriptionStatus);
  const dateKey = getDateKey();
  const monthKey = getMonthKey();
  let usageState;

  try {
    usageState = await readUsageState(userId, dateKey, monthKey);
  } catch (error) {
    sendJson(res, 500, durableStoreErrorPayload(error && error.message ? error.message : "Failed to read usage state."));
    return null;
  }

  const gate = evaluatePlanLimit({
    plan,
    usageState,
    dateKey,
    monthKey
  });

  if (gate.blocked) {
    sendJson(res, 429, lockResponsePayload({
      plan,
      used: gate.used,
      limit: gate.limit,
      code: gate.code,
      error: gate.error,
      upgradeMessage: gate.upgradeMessage
    }));
    return null;
  }

  return {
    userId,
    plan,
    dateKey,
    monthKey,
    usageState
  };
}

async function incrementUsageAndSummarizeOrRespond(res, access) {
  const updatedUsage = applyUsageIncrement({
    plan: access.plan,
    usageState: access.usageState,
    dateKey: access.dateKey,
    monthKey: access.monthKey
  });

  try {
    await writeUsageState(access.userId, updatedUsage);
  } catch (error) {
    sendJson(res, 500, durableStoreErrorPayload(error && error.message ? error.message : "Failed to persist usage state."));
    return null;
  }

  const summary = usageSummary({
    plan: access.plan,
    usageState: updatedUsage,
    dateKey: access.dateKey,
    monthKey: access.monthKey
  });

  return {
    ...summary,
    locked: access.plan === "free" && Number.isFinite(summary.limit) && summary.used >= summary.limit
  };
}

async function analyzeJournalHandler(req, res) {
  if (req.method && req.method !== "POST") {
    return methodNotAllowed(res);
  }

  const body = readBody(req);
  const access = await getUsageAccessOrRespond(req, res, body);

  if (!access) {
    return undefined;
  }

  const openai = getOpenAIClient();

  if (!openai) {
    return missingApiKeyResponse(res);
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
    const summary = await incrementUsageAndSummarizeOrRespond(res, access);

    if (!summary) {
      return undefined;
    }

    return sendJson(res, 200, {
      ...result,
      plan: access.plan,
      used: summary.used,
      limit: summary.limit,
      remaining: summary.remaining,
      locked: summary.locked
    });
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

  const body = readBody(req);
  const access = await getUsageAccessOrRespond(req, res, body);

  if (!access) {
    return undefined;
  }

  const openai = getOpenAIClient();

  if (!openai) {
    return missingApiKeyResponse(res);
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
    const summary = await incrementUsageAndSummarizeOrRespond(res, access);

    if (!summary) {
      return undefined;
    }

    return sendJson(res, 200, {
      ...result,
      plan: access.plan,
      used: summary.used,
      limit: summary.limit,
      remaining: summary.remaining,
      locked: summary.locked
    });
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

  const body = readBody(req);
  const access = await getUsageAccessOrRespond(req, res, body);

  if (!access) {
    return undefined;
  }

  const openai = getOpenAIClient();

  if (!openai) {
    return missingApiKeyResponse(res);
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
    const summary = await incrementUsageAndSummarizeOrRespond(res, access);

    if (!summary) {
      return undefined;
    }

    return sendJson(res, 200, {
      ...result,
      plan: access.plan,
      used: summary.used,
      limit: summary.limit,
      remaining: summary.remaining,
      locked: summary.locked
    });
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

  const body = readBody(req);
  const access = await getUsageAccessOrRespond(req, res, body);

  if (!access) {
    return undefined;
  }

  const plan = access.plan;
  const clientId = getClientId(req, body);
  const message = safeString(body.message, "");
  const context = body.context && typeof body.context === "object" ? body.context : {};

  const openai = getOpenAIClient();

  if (!openai) {
    return missingApiKeyResponse(res);
  }

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

    const summary = await incrementUsageAndSummarizeOrRespond(res, access);

    if (!summary) {
      return undefined;
    }

    return sendJson(res, 200, {
      reply,
      plan,
      used: summary.used,
      limit: summary.limit,
      remaining: summary.remaining,
      locked: summary.locked,
      upgradeMessage: plan === "free" && summary.locked
        ? "You have used all 3 free AI coaching sessions. Upgrade to unlock unlimited AI coaching, personalized guidance, advanced insights, weekly reports, and premium features."
        : ""
    });
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
  healthHandler,
  saveInsightHandler,
  listSavedInsightsHandler,
  deleteSavedInsightHandler
};
