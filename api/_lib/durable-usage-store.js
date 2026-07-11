const DURABLE_USAGE_KEY_PREFIX = "dm:ai-usage:v1:";

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
  const existing = await redisGetJson(key);

  if (!existing) {
    return createDefaultUsageState();
  }

  return pruneState(existing, currentDateKey, currentMonthKey);
}

async function writeUsageState(userId, usageState) {
  const key = usageKey(userId);
  const next = ensureUsageShape(usageState);
  next.updatedAt = new Date().toISOString();
  await redisSetJson(key, next);
}

function isDurableStoreConfigured() {
  return Boolean(getRedisConfig());
}

module.exports = {
  readUsageState,
  writeUsageState,
  isDurableStoreConfigured
};
