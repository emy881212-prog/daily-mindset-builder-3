const fs = require("fs");
const path = require("path");

const DURABLE_INSIGHTS_KEY_PREFIX = "dm:ai-saved:v1:";
const MAX_INSIGHTS_PER_USER = 500;
const LOCAL_INSIGHTS_FILE = path.join(process.cwd(), ".data", "saved-insights.json");
const localInsightsMemory = new Map();
let warnedMissingRedis = false;
let warnedRedisFailure = false;
let warnedLocalFileFailure = false;

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

function warnAdminsOnly(message, mark) {
  if (mark === "missing" && warnedMissingRedis) {
    return;
  }

  if (mark === "redis" && warnedRedisFailure) {
    return;
  }

  if (mark === "local" && warnedLocalFileFailure) {
    return;
  }

  if (mark === "missing") {
    warnedMissingRedis = true;
  }

  if (mark === "redis") {
    warnedRedisFailure = true;
  }

  if (mark === "local") {
    warnedLocalFileFailure = true;
  }

  console.warn(`[saved-insights] ${message}`);
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

async function readLocalStoreObject() {
  try {
    const raw = await fs.promises.readFile(LOCAL_INSIGHTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }

    warnAdminsOnly("Local saved-insights file is unavailable; using in-memory fallback.", "local");
    return {};
  }
}

async function writeLocalStoreObject(data) {
  try {
    await fs.promises.mkdir(path.dirname(LOCAL_INSIGHTS_FILE), { recursive: true });
    await fs.promises.writeFile(LOCAL_INSIGHTS_FILE, JSON.stringify(data), "utf8");
  } catch (_error) {
    warnAdminsOnly("Failed writing local saved-insights file; continuing with in-memory fallback.", "local");
  }
}

async function localGetJson(key) {
  const store = await readLocalStoreObject();

  if (Object.prototype.hasOwnProperty.call(store, key)) {
    return store[key];
  }

  return localInsightsMemory.has(key) ? localInsightsMemory.get(key) : null;
}

async function localSetJson(key, value) {
  localInsightsMemory.set(key, value);
  const store = await readLocalStoreObject();
  store[key] = value;
  await writeLocalStoreObject(store);
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
  const config = getRedisConfig();
  let existing;

  if (config) {
    try {
      existing = await redisGetJson(key);
    } catch (_error) {
      warnAdminsOnly("Redis read failed; falling back to local saved-insights storage.", "redis");
      existing = await localGetJson(key);
    }
  } else {
    warnAdminsOnly("Redis not configured. Using local saved-insights storage fallback.", "missing");
    existing = await localGetJson(key);
  }

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

  const payload = normalizedEntries.slice(0, MAX_INSIGHTS_PER_USER);
  const config = getRedisConfig();

  if (config) {
    try {
      await redisSetJson(key, payload);
      return;
    } catch (_error) {
      warnAdminsOnly("Redis write failed; falling back to local saved-insights storage.", "redis");
    }
  } else {
    warnAdminsOnly("Redis not configured. Using local saved-insights storage fallback.", "missing");
  }

  await localSetJson(key, payload);
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
