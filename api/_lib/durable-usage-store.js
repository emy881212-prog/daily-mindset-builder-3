const fs = require("fs");
const path = require("path");

const DURABLE_USAGE_KEY_PREFIX = "dm:ai-usage:v1:";
const LOCAL_USAGE_FILE = path.join(process.cwd(), ".data", "usage-store.json");
const localUsageMemory = new Map();
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

  console.warn(`[usage-store] ${message}`);
}

function usageKey(userId) {
  return `${DURABLE_USAGE_KEY_PREFIX}${userId}`;
}

async function redisGetJson(key) {
  const config = getRedisConfig();

  if (!config) {
    throw new Error("Durable usage store is not configured. Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.");
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
    throw new Error(`Usage store read failed (${response.status}): ${detail.slice(0, 200)}`);
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
    throw new Error("Durable usage store is not configured. Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.");
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
    throw new Error(`Usage store write failed (${response.status}): ${detail.slice(0, 200)}`);
  }
}

async function readLocalStoreObject() {
  try {
    const raw = await fs.promises.readFile(LOCAL_USAGE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }

    warnAdminsOnly("Local usage file is unavailable; using in-memory fallback.", "local");
    return {};
  }
}

async function writeLocalStoreObject(data) {
  try {
    await fs.promises.mkdir(path.dirname(LOCAL_USAGE_FILE), { recursive: true });
    await fs.promises.writeFile(LOCAL_USAGE_FILE, JSON.stringify(data), "utf8");
  } catch (_error) {
    warnAdminsOnly("Failed writing local usage file; continuing with in-memory fallback.", "local");
  }
}

async function localGetJson(key) {
  const store = await readLocalStoreObject();

  if (Object.prototype.hasOwnProperty.call(store, key)) {
    return store[key];
  }

  return localUsageMemory.has(key) ? localUsageMemory.get(key) : null;
}

async function localSetJson(key, value) {
  localUsageMemory.set(key, value);
  const store = await readLocalStoreObject();
  store[key] = value;
  await writeLocalStoreObject(store);
}

function createDefaultUsageState() {
  return {
    version: 1,
    freeTotal: 0,
    monthly: {},
    fairUseDaily: {},
    fairUseMonthly: {},
    updatedAt: new Date().toISOString()
  };
}

function ensureUsageShape(input) {
  const state = input && typeof input === "object" ? input : {};

  return {
    version: Number.isFinite(Number(state.version)) ? Number(state.version) : 1,
    freeTotal: Number.isFinite(Number(state.freeTotal)) && Number(state.freeTotal) > 0
      ? Math.floor(Number(state.freeTotal))
      : 0,
    monthly: state.monthly && typeof state.monthly === "object" ? state.monthly : {},
    fairUseDaily: state.fairUseDaily && typeof state.fairUseDaily === "object" ? state.fairUseDaily : {},
    fairUseMonthly: state.fairUseMonthly && typeof state.fairUseMonthly === "object" ? state.fairUseMonthly : {},
    updatedAt: safeString(state.updatedAt, "") || new Date().toISOString()
  };
}

function pruneState(state, currentDateKey, currentMonthKey) {
  void currentDateKey;
  void currentMonthKey;
  return ensureUsageShape(state);
}

async function readUsageState(userId, currentDateKey, currentMonthKey) {
  const key = usageKey(userId);
  const config = getRedisConfig();
  let existing;

  if (config) {
    try {
      existing = await redisGetJson(key);
    } catch (_error) {
      warnAdminsOnly("Redis read failed; falling back to local usage storage.", "redis");
      existing = await localGetJson(key);
    }
  } else {
    warnAdminsOnly("Redis not configured. Using local usage storage fallback.", "missing");
    existing = await localGetJson(key);
  }

  if (!existing) {
    return createDefaultUsageState();
  }

  return pruneState(existing, currentDateKey, currentMonthKey);
}

async function writeUsageState(userId, usageState) {
  const key = usageKey(userId);
  const next = ensureUsageShape(usageState);
  next.updatedAt = new Date().toISOString();

  const config = getRedisConfig();

  if (config) {
    try {
      await redisSetJson(key, next);
      return;
    } catch (_error) {
      warnAdminsOnly("Redis write failed; falling back to local usage storage.", "redis");
    }
  } else {
    warnAdminsOnly("Redis not configured. Using local usage storage fallback.", "missing");
  }

  await localSetJson(key, next);
}

function isDurableStoreConfigured() {
  return Boolean(getRedisConfig());
}

module.exports = {
  readUsageState,
  writeUsageState,
  isDurableStoreConfigured
};
