(function () {
  "use strict";

  const ACCOUNT_STORE_KEY = "mindsetAuth:accounts:v1";
  const SESSION_KEY = "mindsetAuth:session:v1";
  const DATA_PREFIX = "mindsetAuth:data:";
  const ACTIVE_DATA_USER_KEY = "mindsetAuth:activeDataUserId";
  const FIREBASE_LAST_UID_KEY = "mindsetAuth:lastFirebaseUid";
  const FIREBASE_READY_KEY = "mindsetAuth:firebaseReady";

  const LEGACY_USER_ID_KEY = "mindsetUserId";
  const LEGACY_USER_EMAIL_KEY = "mindsetUserEmail";
  const LEGACY_USER_NAME_KEY = "mindsetUserName";
  const LEGACY_FALLBACK_USER_ID_KEY = "mindsetFallbackUserId";
  const DEVICE_ID_KEY = "mindsetDeviceId";

  const FIREBASE_SDK_URLS = [
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js"
  ];
  const FIREBASE_APP_NAME_PREFIX = "mindset-";

  const FIRESTORE_CATEGORY_MAP = {
    profile: [/^mindsetuser(name|email|id)$/i, /^profile/i],
    questionnaire_results: [
      /questionnaire/i,
      /quiz/i,
      /answers?/i,
      /assessment/i,
      /patternresponses/i,
      /patternsnapshots/i,
      /onboarding/i,
      /onboardinganswers?/i,
      /questionnaireresults?/i
    ],
    subscription_status: [/^mindsetsubscription$/i, /^mindsetplan$/i, /^freequotesused$/i, /subscription/i],
    journal_entries: [/^dailymindsetjournalentry$/i, /journal/i, /reflection/i, /history/i, /weeklygrowth/i],
    mood_tracker: [
      /^dailymindsetjournalentry$/i,
      /mood/i,
      /energy/i,
      /moodtracker/i,
      /moodentries?/i,
      /moodhistory/i,
      /moodstats?/i,
      /moodstatistics/i
    ],
    gratitude_journal: [/gratitude/i],
    goals: [/goal/i, /dream/i],
    saved_quotes: [/quote/i],
    settings: [/settings?/i, /reminder/i, /preference/i]
  };

  let firebaseInitPromise = null;
  let authStatePromise = null;
  let currentFirebaseUser = null;
  let onAuthStateReadyResolve = null;
  let bootstrapDone = false;
  let periodicSyncStarted = false;
  let syncDebounceTimer = null;

  function debugLog(event, payload) {
    const details = payload && typeof payload === "object" ? payload : { value: payload };
    const entry = {
      event,
      details,
      at: new Date().toISOString()
    };

    try {
      window.__MINDSET_AUTH_DEBUG__ = window.__MINDSET_AUTH_DEBUG__ || [];
      window.__MINDSET_AUTH_DEBUG__.push(entry);
      if (window.__MINDSET_AUTH_DEBUG__.length > 200) {
        window.__MINDSET_AUTH_DEBUG__.splice(0, window.__MINDSET_AUTH_DEBUG__.length - 200);
      }
    } catch (_error) {
      // Ignore debug-cache failures.
    }

    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[mindset-auth]", event, details);
    }
  }

  function safeJsonParse(raw, fallback) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function readAccounts() {
    const raw = localStorage.getItem(ACCOUNT_STORE_KEY) || "[]";
    const parsed = safeJsonParse(raw, []);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry) => entry && typeof entry === "object" && entry.email && entry.id);
  }

  function writeAccounts(accounts) {
    localStorage.setItem(ACCOUNT_STORE_KEY, JSON.stringify(Array.isArray(accounts) ? accounts : []));
  }

  function upsertLocalAccount(account) {
    if (!account || !account.id || !account.email) {
      return;
    }

    const existing = readAccounts();
    const next = existing.filter((entry) => entry.id !== account.id && normalizeEmail(entry.email) !== normalizeEmail(account.email));
    next.push(account);
    writeAccounts(next);
  }

  function isReservedStorageKey(key) {
    return key === ACCOUNT_STORE_KEY
      || key === SESSION_KEY
      || key === ACTIVE_DATA_USER_KEY
      || key === FIREBASE_LAST_UID_KEY
      || key === FIREBASE_READY_KEY
      || key === LEGACY_USER_ID_KEY
      || key === LEGACY_USER_EMAIL_KEY
      || key === LEGACY_USER_NAME_KEY
      || key === LEGACY_FALLBACK_USER_ID_KEY
      || key === DEVICE_ID_KEY
      || key.indexOf(DATA_PREFIX) === 0;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  function getFirebaseConfig() {
    if (window.__FIREBASE_CONFIG__ && typeof window.__FIREBASE_CONFIG__ === "object") {
      return window.__FIREBASE_CONFIG__;
    }

    const fromLocalStorage = safeJsonParse(localStorage.getItem("mindsetFirebaseConfig") || "", null);

    if (fromLocalStorage && typeof fromLocalStorage === "object") {
      return fromLocalStorage;
    }

    return null;
  }

  function isFirebaseConfigUsable(config) {
    return Boolean(
      config
      && typeof config === "object"
      && String(config.apiKey || "").trim()
      && String(config.authDomain || "").trim()
      && String(config.projectId || "").trim()
    );
  }

  async function ensureFirebaseReady() {
    if (firebaseInitPromise) {
      return firebaseInitPromise;
    }

    firebaseInitPromise = (async () => {
      const config = getFirebaseConfig();
      debugLog("firebase-init-start", {
        hasConfig: Boolean(config),
        projectId: config && config.projectId ? String(config.projectId) : "",
        authDomain: config && config.authDomain ? String(config.authDomain) : ""
      });

      if (!isFirebaseConfigUsable(config)) {
        debugLog("firebase-init-config-invalid", {
          hasApiKey: Boolean(config && config.apiKey),
          hasAuthDomain: Boolean(config && config.authDomain),
          hasProjectId: Boolean(config && config.projectId)
        });
        throw new Error("Firebase is not configured. Set window.__FIREBASE_CONFIG__ in firebase-config.js.");
      }

      for (const url of FIREBASE_SDK_URLS) {
        if (typeof window.firebase === "undefined" || !window.firebase.auth || !window.firebase.firestore) {
          await loadScript(url);
        }
      }

      if (!window.firebase || !window.firebase.apps) {
        debugLog("firebase-init-sdk-missing", {});
        throw new Error("Firebase SDK failed to initialize in browser.");
      }

      let app = null;
      const existingApps = Array.isArray(window.firebase.apps) ? window.firebase.apps : [];

      app = existingApps.find((candidate) => {
        return candidate && candidate.options && String(candidate.options.projectId || "").trim() === String(config.projectId || "").trim();
      }) || null;

      if (!app) {
        if (!existingApps.length) {
          app = window.firebase.initializeApp(config);
        } else {
          const appName = FIREBASE_APP_NAME_PREFIX + String(config.projectId || "").trim();
          app = window.firebase.initializeApp(config, appName);
        }
      }

      const activeProjectId = app && app.options ? String(app.options.projectId || "").trim() : "";

      if (!activeProjectId || activeProjectId !== String(config.projectId || "").trim()) {
        debugLog("firebase-init-project-mismatch", {
          activeProjectId,
          configProjectId: String(config.projectId || "").trim()
        });
        throw new Error("Firebase initialized with unexpected project. Check firebase-config.js values.");
      }

      debugLog("firebase-init-ready", {
        appName: app && app.name ? String(app.name) : "",
        projectId: activeProjectId,
        appCount: existingApps.length
      });

      localStorage.setItem(FIREBASE_READY_KEY, "true");
      return {
        app,
        auth: app.auth(),
        db: app.firestore(),
        projectId: activeProjectId
      };
    })();

    return firebaseInitPromise;
  }

  function parseStoredValue(value) {
    const parsed = safeJsonParse(value, null);
    return parsed === null ? value : parsed;
  }

  function extractCategoryData(snapshot, category) {
    const patterns = FIRESTORE_CATEGORY_MAP[category] || [];
    const data = {};

    Object.keys(snapshot || {}).forEach((key) => {
      const isMatch = patterns.some((pattern) => pattern.test(key));

      if (!isMatch) {
        return;
      }

      data[key] = parseStoredValue(snapshot[key]);
    });

    return data;
  }

  function mergeSnapshots(remoteSnapshot, localSnapshot) {
    return {
      ...(remoteSnapshot && typeof remoteSnapshot === "object" ? remoteSnapshot : {}),
      ...(localSnapshot && typeof localSnapshot === "object" ? localSnapshot : {})
    };
  }

  function firestoreRefs(db, uid) {
    const userRef = db.collection("users").doc(uid);

    return {
      userRef,
      snapshotRef: userRef.collection("app_state").doc("local_storage_snapshot")
    };
  }

  function toAccountFromFirebaseUser(user) {
    if (!user) {
      return null;
    }

    const email = normalizeEmail(user.email || "");

    return {
      id: user.uid,
      uid: user.uid,
      email,
      name: String(user.displayName || "").trim(),
      emailVerified: Boolean(user.emailVerified),
      provider: "firebase",
      createdAt: user.metadata && user.metadata.creationTime
        ? new Date(user.metadata.creationTime).toISOString()
        : new Date().toISOString(),
      lastLoginAt: user.metadata && user.metadata.lastSignInTime
        ? new Date(user.metadata.lastSignInTime).toISOString()
        : new Date().toISOString()
    };
  }

  function captureAppSnapshot() {
    const snapshot = {};

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);

      if (!key || isReservedStorageKey(key)) {
        continue;
      }

      const value = localStorage.getItem(key);

      if (typeof value === "string") {
        snapshot[key] = value;
      }
    }

    return snapshot;
  }

  function getCurrentSession() {
    return safeJsonParse(localStorage.getItem(SESSION_KEY) || "", null);
  }

  function writeCurrentSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function setLegacyUserFields(account) {
    if (!account) {
      localStorage.removeItem(LEGACY_USER_ID_KEY);
      localStorage.removeItem(LEGACY_USER_EMAIL_KEY);
      localStorage.removeItem(LEGACY_USER_NAME_KEY);
      localStorage.removeItem(LEGACY_FALLBACK_USER_ID_KEY);
      return;
    }

    localStorage.setItem(LEGACY_USER_ID_KEY, String(account.id));
    localStorage.setItem(LEGACY_USER_EMAIL_KEY, String(account.email));
    localStorage.setItem(LEGACY_USER_NAME_KEY, String(account.name || ""));
    localStorage.removeItem(LEGACY_FALLBACK_USER_ID_KEY);
    localStorage.setItem(FIREBASE_LAST_UID_KEY, String(account.id));
  }

  function clearAppDataSpace() {
    const keys = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);

      if (key && !isReservedStorageKey(key)) {
        keys.push(key);
      }
    }

    keys.forEach((key) => localStorage.removeItem(key));
  }

  function getSnapshotKey(userId) {
    return DATA_PREFIX + String(userId || "").trim();
  }

  function saveUserSnapshot(userId) {
    if (!userId) {
      return;
    }

    const snapshot = captureAppSnapshot();
    localStorage.setItem(getSnapshotKey(userId), JSON.stringify(snapshot));
    localStorage.setItem(ACTIVE_DATA_USER_KEY, String(userId));
  }

  function loadUserSnapshot(userId) {
    if (!userId) {
      clearAppDataSpace();
      localStorage.removeItem(ACTIVE_DATA_USER_KEY);
      return;
    }

    const snapshotRaw = localStorage.getItem(getSnapshotKey(userId)) || "{}";
    const snapshot = safeJsonParse(snapshotRaw, {});

    clearAppDataSpace();

    Object.keys(snapshot).forEach((key) => {
      const value = snapshot[key];
      if (typeof value === "string" && !isReservedStorageKey(key)) {
        localStorage.setItem(key, value);
      }
    });

    localStorage.setItem(ACTIVE_DATA_USER_KEY, String(userId));
  }

  function getCurrentAccount() {
    const session = getCurrentSession();

    if (!session || !session.userId) {
      return null;
    }

    return readAccounts().find((entry) => entry.id === session.userId) || null;
  }

  function setCurrentSessionFromAccount(account) {
    if (!account) {
      localStorage.removeItem(SESSION_KEY);
      setLegacyUserFields(null);
      return;
    }

    writeCurrentSession({
      userId: account.id,
      email: account.email,
      name: account.name || "",
      loggedInAt: new Date().toISOString(),
      provider: "firebase",
      emailVerified: Boolean(account.emailVerified)
    });

    setLegacyUserFields(account);
    upsertLocalAccount(account);
  }

  async function readCloudSnapshot(db, uid) {
    const refs = firestoreRefs(db, uid);
    const doc = await refs.snapshotRef.get();

    if (!doc.exists) {
      return {};
    }

    const payload = doc.data() || {};
    return payload && typeof payload.snapshot === "object" ? payload.snapshot : {};
  }

  async function writeCloudSnapshot(db, uid, snapshot) {
    const refs = firestoreRefs(db, uid);

    await refs.snapshotRef.set({
      snapshot,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }

  async function writeCategoryDocs(db, account, snapshot) {
    const refs = firestoreRefs(db, account.id);

    await refs.userRef.set({
      profile: {
        uid: account.id,
        email: account.email,
        name: account.name || "",
        emailVerified: Boolean(account.emailVerified),
        provider: "firebase"
      },
      updatedAt: new Date().toISOString(),
      createdAt: account.createdAt || new Date().toISOString()
    }, { merge: true });

    const categories = Object.keys(FIRESTORE_CATEGORY_MAP);

    for (const category of categories) {
      const categoryData = extractCategoryData(snapshot, category);

      await refs.userRef.collection("categories").doc(category).set({
        data: categoryData,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  }

  async function migrateLocalDataToCloud(db, account, localSnapshot) {
    const snapshot = localSnapshot && typeof localSnapshot === "object"
      ? localSnapshot
      : captureAppSnapshot();

    const remoteSnapshot = await readCloudSnapshot(db, account.id);
    const merged = mergeSnapshots(remoteSnapshot, snapshot);

    await writeCloudSnapshot(db, account.id, merged);
    await writeCategoryDocs(db, account, merged);

    localStorage.setItem(getSnapshotKey(account.id), JSON.stringify(merged));
    return merged;
  }

  async function hydrateLocalFromCloud(db, account, localSnapshot) {
    const merged = await migrateLocalDataToCloud(db, account, localSnapshot);
    clearAppDataSpace();

    Object.keys(merged).forEach((key) => {
      if (isReservedStorageKey(key)) {
        return;
      }

      const value = merged[key];

      if (typeof value === "string") {
        localStorage.setItem(key, value);
        return;
      }

      localStorage.setItem(key, JSON.stringify(value));
    });

    localStorage.setItem(ACTIVE_DATA_USER_KEY, String(account.id));
  }

  async function persistCurrentUserDataToCloud() {
    const account = getCurrentAccount();

    if (!account || !account.id) {
      return;
    }

    try {
      const sdk = await ensureFirebaseReady();
      const snapshot = captureAppSnapshot();
      await writeCloudSnapshot(sdk.db, account.id, snapshot);
      await writeCategoryDocs(sdk.db, account, snapshot);
      localStorage.setItem(getSnapshotKey(account.id), JSON.stringify(snapshot));
    } catch (error) {
      console.warn("[auth] Could not persist to cloud:", error && error.message ? error.message : error);
      saveUserSnapshot(account.id);
    }
  }

  function scheduleCloudSync() {
    if (!getCurrentAccount()) {
      return;
    }

    if (syncDebounceTimer) {
      window.clearTimeout(syncDebounceTimer);
    }

    syncDebounceTimer = window.setTimeout(() => {
      persistCurrentUserDataToCloud().catch(() => {});
    }, 800);
  }

  function installLocalStorageCloudBridge() {
    const storageProto = window.Storage && window.Storage.prototype;

    if (!storageProto || storageProto.__mindsetCloudBridgeInstalled) {
      return;
    }

    const originalSetItem = storageProto.setItem;
    const originalRemoveItem = storageProto.removeItem;
    const originalClear = storageProto.clear;

    storageProto.setItem = function patchedSetItem(key, value) {
      const normalizedKey = String(key || "");
      originalSetItem.call(this, key, value);

      if (!isReservedStorageKey(normalizedKey)) {
        scheduleCloudSync();
      }
    };

    storageProto.removeItem = function patchedRemoveItem(key) {
      const normalizedKey = String(key || "");
      originalRemoveItem.call(this, key);

      if (!isReservedStorageKey(normalizedKey)) {
        scheduleCloudSync();
      }
    };

    storageProto.clear = function patchedClear() {
      originalClear.call(this);
      scheduleCloudSync();
    };

    storageProto.__mindsetCloudBridgeInstalled = true;
  }

  function restoreSession() {
    const session = getCurrentSession();

    if (!session || !session.userId) {
      setLegacyUserFields(null);
      return null;
    }

    const account = readAccounts().find((entry) => entry.id === session.userId);

    if (!account) {
      localStorage.removeItem(SESSION_KEY);
      setLegacyUserFields(null);
      return null;
    }

    const activeDataUser = String(localStorage.getItem(ACTIVE_DATA_USER_KEY) || "").trim();

    if (activeDataUser && activeDataUser !== account.id) {
      loadUserSnapshot(account.id);
    }

    if (!activeDataUser) {
      localStorage.setItem(ACTIVE_DATA_USER_KEY, account.id);
    }

    setLegacyUserFields(account);
    return account;
  }

  function persistCurrentUserData() {
    const session = getCurrentSession();

    if (!session || !session.userId) {
      return;
    }

    saveUserSnapshot(session.userId);
    persistCurrentUserDataToCloud().catch(() => {});
  }

  async function awaitAuthStateReady() {
    if (authStatePromise) {
      return authStatePromise;
    }

    authStatePromise = new Promise((resolve) => {
      onAuthStateReadyResolve = resolve;
    });

    return authStatePromise;
  }

  async function bootstrapFirebaseAuthListener() {
    if (bootstrapDone) {
      return;
    }

    bootstrapDone = true;

    try {
      const sdk = await ensureFirebaseReady();
      sdk.auth.onAuthStateChanged(async (firebaseUser) => {
        currentFirebaseUser = firebaseUser || null;

        if (!firebaseUser) {
          setCurrentSessionFromAccount(null);
          if (onAuthStateReadyResolve) {
            onAuthStateReadyResolve();
            onAuthStateReadyResolve = null;
          }
          return;
        }

        const account = toAccountFromFirebaseUser(firebaseUser);
        setCurrentSessionFromAccount(account);

          await hydrateLocalFromCloud(sdk.db, account, captureAppSnapshot());

        if (onAuthStateReadyResolve) {
          onAuthStateReadyResolve();
          onAuthStateReadyResolve = null;
        }
      });
    } catch (error) {
      console.warn("[auth] Firebase listener unavailable:", error && error.message ? error.message : error);

      if (onAuthStateReadyResolve) {
        onAuthStateReadyResolve();
        onAuthStateReadyResolve = null;
      }
    }
  }

  async function signUp(input) {
    const name = String((input && input.name) || "").trim();
    const email = normalizeEmail(input && input.email);
    const password = String((input && input.password) || "");

    if (!name) {
      throw new Error("Please enter your name.");
    }

    if (!email || !email.includes("@")) {
      throw new Error("Please enter a valid email.");
    }

    if (password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }

    const localSnapshot = captureAppSnapshot();
    const sdk = await ensureFirebaseReady();
    debugLog("signup-attempt", {
      email,
      projectId: sdk && sdk.projectId ? sdk.projectId : "",
      authAppName: sdk && sdk.app && sdk.app.name ? sdk.app.name : ""
    });
    const authResult = await createUserWithEmailAndPassword(sdk.auth, email, password);
    const user = authResult.user;

    debugLog("signup-create-user-result", {
      hasUser: Boolean(user),
      uid: user && user.uid ? user.uid : "",
      email: user && user.email ? user.email : ""
    });

    if (!user) {
      throw new Error("Account creation failed.");
    }

    const activeFirebaseUser = await assertFirebaseCurrentUser(user.uid, "signup");

    if (name && typeof user.updateProfile === "function") {
      await user.updateProfile({ displayName: name });
    }

    if (typeof user.sendEmailVerification === "function") {
      await user.sendEmailVerification();
    }

    const account = toAccountFromFirebaseUser(user);
    setCurrentSessionFromAccount(account);
    await hydrateLocalFromCloud(sdk.db, account, localSnapshot);
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[mindset-auth] signup-firebase-uid", activeFirebaseUser.uid);
    }
    debugLog("signup-complete", {
      uid: account.id,
      email: account.email,
      emailVerified: Boolean(account.emailVerified)
    });
    return account;
  }

  async function logIn(input) {
    const email = normalizeEmail(input && input.email);
    const password = String((input && input.password) || "");

    if (!email || !password) {
      throw new Error("Please enter your email and password.");
    }

    const localSnapshot = captureAppSnapshot();
    const sdk = await ensureFirebaseReady();
    const authResult = await signInWithEmailAndPassword(sdk.auth, email, password);
    const user = authResult.user;

    if (!user) {
      throw new Error("Login failed.");
    }

    await assertFirebaseCurrentUser(user.uid, "login");

    const account = toAccountFromFirebaseUser(user);
    setCurrentSessionFromAccount(account);
    await hydrateLocalFromCloud(sdk.db, account, localSnapshot);
    return account;
  }

  async function assertFirebaseCurrentUser(expectedUid, operation) {
    const sdk = await ensureFirebaseReady();
    const firebaseUser = sdk && sdk.auth ? sdk.auth.currentUser : null;
    const op = String(operation || "auth");

    if (!firebaseUser || !firebaseUser.uid) {
      debugLog("auth-current-user-missing", { operation: op });
      throw new Error("Firebase session missing after " + op + ". Please try again.");
    }

    if (expectedUid && firebaseUser.uid !== expectedUid) {
      debugLog("auth-current-user-mismatch", {
        operation: op,
        expectedUid,
        actualUid: firebaseUser.uid
      });
      throw new Error("Firebase user mismatch after " + op + ". Please sign in again.");
    }

    return firebaseUser;
  }

  async function requestPasswordReset(emailInput) {
    const email = normalizeEmail(emailInput);

    if (!email) {
      throw new Error("Please enter your email first.");
    }

    const sdk = await ensureFirebaseReady();
    await sdk.auth.sendPasswordResetEmail(email);
    return { ok: true };
  }

  async function resendVerificationEmail() {
    const sdk = await ensureFirebaseReady();
    const user = sdk.auth.currentUser;

    if (!user) {
      throw new Error("Please log in first.");
    }

    if (user.emailVerified) {
      return { ok: true, alreadyVerified: true };
    }

    await user.sendEmailVerification();
    return { ok: true, alreadyVerified: false };
  }

  async function refreshCurrentUser() {
    const sdk = await ensureFirebaseReady();
    const user = sdk.auth.currentUser;

    if (!user) {
      return null;
    }

    await user.reload();
    const refreshed = sdk.auth.currentUser;
    const account = toAccountFromFirebaseUser(refreshed);
    setCurrentSessionFromAccount(account);
    return account;
  }

  async function logOut() {
    await persistCurrentUserDataToCloud();

    try {
      const sdk = await ensureFirebaseReady();
      await sdk.auth.signOut();
    } catch (_error) {
      // Keep local cleanup behavior even if cloud sign-out fails.
    }

    localStorage.removeItem(SESSION_KEY);
    setLegacyUserFields(null);
    clearAppDataSpace();
    localStorage.removeItem(ACTIVE_DATA_USER_KEY);
  }

  function initialize() {
    const account = restoreSession();

    installLocalStorageCloudBridge();

    bootstrapFirebaseAuthListener();
    awaitAuthStateReady().catch(() => {});

    if (!periodicSyncStarted) {
      periodicSyncStarted = true;

      window.setInterval(() => {
        if (getCurrentAccount()) {
          persistCurrentUserDataToCloud().catch(() => {});
        }
      }, 30000);

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          persistCurrentUserDataToCloud().catch(() => {});
        }
      });
    }

    window.addEventListener("beforeunload", () => {
      persistCurrentUserData();
    });

    return account;
  }

  window.MindsetAuth = {
    initialize,
    restoreSession,
    signup: signUp,
    login: logIn,
    resetPassword: requestPasswordReset,
    resendVerificationEmail,
    refreshCurrentUser,
    logout: logOut,
    getCurrentUser: getCurrentAccount,
    isAuthenticated: function isAuthenticated() {
      return Boolean(getCurrentAccount());
    },
    persistCurrentUserData,
    ensureFirebaseReady,
    assertFirebaseSession: assertFirebaseCurrentUser,
    awaitAuthStateReady,
    getFirebaseUser: function getFirebaseUser() {
      return currentFirebaseUser;
    }
  };

  window.authClient = function authClientGlobal() {
    return window.MindsetAuth || null;
  };

  function createUserWithEmailAndPassword(auth, email, password) {
    if (!auth || typeof auth.createUserWithEmailAndPassword !== "function") {
      debugLog("signup-create-user-auth-unavailable", {
        hasAuth: Boolean(auth),
        hasMethod: Boolean(auth && auth.createUserWithEmailAndPassword)
      });
      throw new Error("Firebase Auth is not ready for signup.");
    }

    debugLog("signup-create-user-call", {
      email,
      authType: typeof auth
    });

    return auth.createUserWithEmailAndPassword(email, password)
      .catch((error) => {
        debugLog("signup-create-user-error", {
          code: error && error.code ? error.code : "",
          message: error && error.message ? error.message : "",
          name: error && error.name ? error.name : ""
        });
        throw error;
      });
  }

  function signInWithEmailAndPassword(auth, email, password) {
    if (!auth || typeof auth.signInWithEmailAndPassword !== "function") {
      throw new Error("Firebase Auth is not ready for login.");
    }

    return auth.signInWithEmailAndPassword(email, password);
  }
})();
