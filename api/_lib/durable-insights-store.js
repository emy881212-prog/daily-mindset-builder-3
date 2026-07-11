const DURABLE_INSIGHTS_KEY_PREFIX = "dm:ai-saved:v1:";
const MAX_INSIGHTS_PER_USER = 500;

function safeString(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value).trim() || fallback;
}

function getRedisConfig() {
  const baseUrl = safeString(process.env.UPSTASH_REDIS_REST_URL, "");
  const token = safeString(process.env.UPSTASH_REDIS_REST_TOKEN, "");

  if (!baseUrl || !token) {
    return null;
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

function insightsKey(userId) {
  return `${DURABLE_INSIGHTS_KEY_PREFIX}${userId}`;
}

async function redisGetJson(key) {
  const config = getRedisConfig();

  if (!config) {
    throw new Error("Durable saved-insights store is not configured. Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.");
  }

  const url = `${config.baseUrl}/get/${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Saved-insights read failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const payload = await response.json().catch(() => ({}));
  const raw = payload && typeof payload.result === "string" ? payload.result : "";

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

async function redisSetJson(key, value) {
  const config = getRedisConfig();

  if (!config) {
    throw new Error("Durable saved-insights store is not configured. Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.");
  }

  const encodedValue = encodeURIComponent(JSON.stringify(value));
  const url = `${config.baseUrl}/set/${encodeURIComponent(key)}/${encodedValue}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Saved-insights write failed (${response.status}): ${detail.slice(0, 200)}`);
  }
}

function normalizeEntry(entry) {
  const source = entry && typeof entry === "object" ? entry : {};

  return {
    id: safeString(source.id, ""),
    userId: safeString(source.userId, ""),
    featureType: safeString(source.featureType, ""),
    responseContent: safeString(source.responseContent, ""),
    createdAt: safeString(source.createdAt, "") || new Date().toISOString()
  };
}

async function readSavedInsights(userId) {
  const key = insightsKey(userId);
  const existing = await redisGetJson(key);

  if (!Array.isArray(existing)) {
    return [];
  }

  return existing
    .map(normalizeEntry)
    .filter((entry) => entry.id && entry.userId && entry.featureType && entry.responseContent)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function writeSavedInsights(userId, entries) {
  const key = insightsKey(userId);
  const normalizedEntries = Array.isArray(entries)
    ? entries.map(normalizeEntry).filter((entry) => entry.id && entry.userId)
    : [];

  await redisSetJson(key, normalizedEntries.slice(0, MAX_INSIGHTS_PER_USER));
}

function isInsightsStoreConfigured() {
  return Boolean(getRedisConfig());
}

module.exports = {
  readSavedInsights,
  writeSavedInsights,
  isInsightsStoreConfigured,
  MAX_INSIGHTS_PER_USER
};
