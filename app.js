const storageKey = "vip-guestlist-checkins-v1";
const accessCodeKey = "vip-guestlist-access-code-v1";
const configuredSync = globalThis.GUESTLIST_SYNC_CONFIG;
const defaultSyncConfig = {
  endpoint: "",
  secret: "",
  pollMs: 3000,
  // Which lists this event uses. Defaults to both. Set to e.g. ["skiplist"]
  // in sync-config.js to run an event with only one list.
  enabledLists: ["guestlist", "skiplist"],
};
const syncConfig = configuredSync ? { ...defaultSyncConfig, ...configuredSync } : defaultSyncConfig;
const allListConfigs = {
  guestlist: {
    label: "Gästeliste",
    sheetName: "Gästeliste",
  },
  skiplist: {
    label: "Skipliste",
    sheetName: "Skipliste",
  },
};
const enabledListIds = Object.keys(allListConfigs).filter((listId) => syncConfig.enabledLists.includes(listId));
const listConfigs = Object.fromEntries(enabledListIds.map((listId) => [listId, allListConfigs[listId]]));

const state = {
  activeListId: enabledListIds[0] || "guestlist",
  lists: Object.fromEntries(enabledListIds.map((listId) => [listId, []])),
  checkins: readCheckins(),
  pendingMutations: {},
  query: "",
  syncStatus: "Syncing with Google Sheets...",
};

let latestAppliedSyncRun = 0;
let appStarted = false;

const elements = {
  checkedCount: document.querySelector("#checked-count"),
  syncStatus: document.querySelector("#sync-status"),
  totalCount: document.querySelector("#total-count"),
  detailStatus: document.querySelector("#detail-status"),
  detailTime: document.querySelector("#detail-time"),
  detailTitle: document.querySelector("#detail-title"),
  detailView: document.querySelector("#detail-view"),
  emptyState: document.querySelector("#empty-state"),
  guestList: document.querySelector("#guest-list"),
  listTabsNav: document.querySelector("#list-tabs-nav"),
  listTabs: document.querySelectorAll("[data-list-tab]"),
  loading: document.querySelector("#loading"),
  resetGuest: document.querySelector("#reset-guest"),
  search: document.querySelector("#search"),
  accessGate: document.querySelector("#access-gate"),
  accessForm: document.querySelector("#access-form"),
  accessInput: document.querySelector("#access-input"),
  accessError: document.querySelector("#access-error"),
  accessSubmit: document.querySelector("#access-submit"),
};

await boot();

async function boot() {
  if (!syncConfig.endpoint) {
    elements.loading.textContent = "Google Sheets sync is not configured. Set GUESTLIST_SYNC_CONFIG.endpoint in sync-config.js.";
    return;
  }

  bindGate();
  setupListTabs();

  const code = takeAccessCodeFromUrl() || readStoredCode();
  if (code) {
    syncConfig.secret = code;
    await start({ fromStorage: true });
  } else {
    showGate();
  }
}

async function start({ fromStorage = false } = {}) {
  setGateBusy(true);
  elements.accessError.textContent = "";

  try {
    state.lists = await loadLists();

    storeCode(syncConfig.secret);
    hideGate();
    elements.loading.classList.add("hidden");

    if (!appStarted) {
      bindEvents();
      startSync();
      appStarted = true;
    }

    render();
    renderRoute();
  } catch (error) {
    setGateBusy(false);
    syncConfig.secret = "";
    console.error(error);

    if (isAuthError(error)) {
      clearStoredCode();
      showGate(fromStorage ? "That code is no longer valid. Enter the current code." : "That code didn't work. Try again.");
    } else {
      showGate(error.message || "Could not reach the guest list. Check your connection and try again.");
    }
  }
}

function setupListTabs() {
  elements.listTabs.forEach((tab) => {
    if (!listConfigs[tab.dataset.listTab]) {
      tab.classList.add("hidden");
    }
  });
  elements.listTabsNav.classList.toggle("hidden", enabledListIds.length <= 1);
}

function bindGate() {
  elements.accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = elements.accessInput.value.trim();
    if (!code) {
      return;
    }
    syncConfig.secret = code;
    await start({ fromStorage: false });
  });
}

function showGate(message = "") {
  elements.accessError.textContent = message;
  elements.accessGate.classList.remove("hidden");
  setGateBusy(false);
  elements.accessInput.focus();
  elements.accessInput.select();
}

function hideGate() {
  elements.accessGate.classList.add("hidden");
  elements.accessInput.value = "";
}

function setGateBusy(isBusy) {
  elements.accessSubmit.disabled = isBusy;
  elements.accessSubmit.textContent = isBusy ? "Checking..." : "Unlock";
}

function isAuthError(error) {
  return /unauthorized/i.test(error?.message || "");
}

function takeAccessCodeFromUrl() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  if (!code) {
    return "";
  }

  url.searchParams.delete("code");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return code.trim();
}

function readStoredCode() {
  try {
    return localStorage.getItem(accessCodeKey) || "";
  } catch {
    return "";
  }
}

function storeCode(code) {
  try {
    localStorage.setItem(accessCodeKey, code);
  } catch {
    // Ignore storage failures; the code stays in memory for this session.
  }
}

function clearStoredCode() {
  try {
    localStorage.removeItem(accessCodeKey);
  } catch {
    // Ignore storage failures.
  }
}

function bindEvents() {
  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  elements.listTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeListId = tab.dataset.listTab;
      state.query = "";
      elements.search.value = "";
      location.hash = "";
      render();
    });
  });

  elements.guestList.addEventListener("click", (event) => {
    const checkButton = event.target.closest("[data-check-id]");
    const detailsButton = event.target.closest("[data-detail-id]");
    const guestCard = event.target.closest("[data-guest-id]");

    if (checkButton) {
      toggleGuest(checkButton.dataset.checkId);
      return;
    }

    if (detailsButton) {
      openDetail(detailsButton.dataset.detailId);
      return;
    }

    if (guestCard && state.checkins[guestCard.dataset.guestId]) {
      openDetail(guestCard.dataset.guestId);
    }
  });

  elements.resetGuest.addEventListener("click", async () => {
    const guestId = getRouteGuestId();
    if (!guestId) return;

    const updatedAt = markPendingReset(guestId);
    delete state.checkins[guestId];
    writeCheckins();
    location.hash = "";
    render();
    await syncGuestReset(guestId, updatedAt);
  });

  document.querySelector("#close-detail").addEventListener("click", () => {
    location.hash = "";
  });

  globalThis.addEventListener("hashchange", renderRoute);
}

async function loadLists() {
  const entries = await Promise.all(
    Object.entries(listConfigs).map(async ([listId, config]) => {
      const response = await requestSync("guests", { list: config.sheetName });
      return [listId, mapGuestRows(response.guests || [], listId)];
    }),
  );
  state.syncStatus = "Loaded lists from Google Sheets";
  return Object.fromEntries(entries);
}

function mapGuestRows(rows, listId) {
  return rows.map((row, index) => {
    const lastName = clean(row.Name);
    const firstName = clean(row.Vorname);
    const status = clean(row.Status);
    const category = clean(row.Kategorie);

    return {
      id: makeGuestId(listId, lastName, firstName, index),
      listId,
      lastName,
      firstName,
      status,
      category,
      displayName: [firstName, lastName].filter(Boolean).join(" "),
    };
  });
}

function render() {
  const filteredGuests = getFilteredGuests();
  const activeGuests = getActiveGuests();
  const checkedCount = Object.keys(state.checkins).filter((id) => activeGuests.some((guest) => guest.id === id)).length;

  elements.checkedCount.textContent = checkedCount;
  elements.totalCount.textContent = activeGuests.length;
  elements.syncStatus.textContent = state.syncStatus;
  elements.listTabs.forEach((tab) => {
    const isActive = tab.dataset.listTab === state.activeListId;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });
  elements.emptyState.classList.toggle("hidden", filteredGuests.length > 0);
  elements.guestList.innerHTML = filteredGuests.map(renderGuest).join("");
}

function renderGuest(guest) {
  const checkin = state.checkins[guest.id];
  const checked = Boolean(checkin);
  const meta = [guest.status, guest.category].filter(Boolean);

  return `
    <li class="guest-card ${checked ? "checked-in" : ""}" data-guest-id="${escapeHtml(guest.id)}">
      <button class="check-button" type="button" data-check-id="${escapeHtml(guest.id)}" aria-label="${checked ? "Reset" : "Check in"} ${escapeHtml(guest.displayName)}">
        ${checked ? "✓" : ""}
      </button>
      <div class="guest-main">
        <p class="guest-name">${escapeHtml(guest.displayName)}</p>
        <div class="guest-meta">
          ${meta.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")}
          ${checked ? `<span>${formatTime(checkin.checkedInAt)}</span>` : ""}
        </div>
      </div>
      <button class="details-button" type="button" data-detail-id="${escapeHtml(guest.id)}" ${checked ? "" : "disabled"}>
        Details
      </button>
    </li>
  `;
}

function renderRoute() {
  const guestId = getRouteGuestId();
  const guest = getAllGuests().find((item) => item.id === guestId);
  const checkin = guest ? state.checkins[guest.id] : null;

  if (!guest || !checkin) {
    elements.detailView.classList.add("hidden");
    return;
  }

  elements.detailTitle.textContent = guest.displayName;
  elements.detailTime.textContent = formatDateTime(checkin.checkedInAt);
  elements.detailStatus.textContent = [listConfigs[guest.listId]?.label, guest.status, guest.category].filter(Boolean).join(" · ") || "VIP";
  elements.detailView.classList.remove("hidden");
}

async function toggleGuest(guestId) {
  if (state.checkins[guestId]) {
    location.hash = `guest=${encodeURIComponent(guestId)}`;
    renderRoute();
    return;
  }

  const checkedInAt = new Date().toISOString();
  const updatedAt = markPendingCheckin(guestId, checkedInAt);
  state.checkins[guestId] = {
    checkedInAt,
  };
  writeCheckins();
  render();
  await syncGuestCheckin(guestId, checkedInAt, updatedAt);
}

function openDetail(guestId) {
  location.hash = `guest=${encodeURIComponent(guestId)}`;
}

function getFilteredGuests() {
  const normalizedQuery = normalize(state.query);
  const activeGuests = getActiveGuests();

  if (!normalizedQuery) {
    return activeGuests;
  }

  return activeGuests.filter((guest) => {
    return normalize([guest.displayName, guest.lastName, guest.firstName, guest.status, guest.category].join(" ")).includes(normalizedQuery);
  });
}

function getActiveGuests() {
  return state.lists[state.activeListId] || [];
}

function getAllGuests() {
  return Object.values(state.lists).flat();
}

function getRouteGuestId() {
  const match = /^#guest=(.+)$/.exec(location.hash);
  return match ? decodeURIComponent(match[1]) : "";
}

function readCheckins() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch {
    return {};
  }
}

function writeCheckins() {
  localStorage.setItem(storageKey, JSON.stringify(state.checkins));
}

function startSync() {
  syncFromSheet();
  setInterval(syncFromSheet, syncConfig.pollMs);
}

async function syncFromSheet() {
  const syncRun = Date.now();

  try {
    const response = await requestSync("list");
    if (syncRun < latestAppliedSyncRun) {
      return;
    }
    latestAppliedSyncRun = syncRun;

    const checkins = response.checkins || {};
    const knownGuestIds = new Set(getAllGuests().map((guest) => guest.id));
    const sheetCheckins = Object.fromEntries(
      Object.entries(checkins).filter(([guestId]) => knownGuestIds.has(guestId)),
    );
    state.checkins = mergeSheetCheckins(sheetCheckins);
    state.syncStatus = `Synced ${formatTime(new Date().toISOString())}`;
    writeCheckins();
    render();
    renderRoute();
  } catch (error) {
    state.syncStatus = "Sync unavailable, using local state";
    render();
    console.error(error);
  }
}

async function syncGuestCheckin(guestId, checkedInAt, updatedAt) {
  try {
    await requestSync("checkin", { guestId, checkedInAt, updatedAt });
    state.syncStatus = "Sync pending";
    render();
  } catch (error) {
    state.syncStatus = "Sync pending";
    render();
    console.error(error);
  }
}

async function syncGuestReset(guestId, updatedAt) {
  try {
    await requestSync("reset", { guestId, updatedAt });
    state.syncStatus = "Sync pending";
    render();
  } catch (error) {
    state.syncStatus = "Sync pending";
    render();
    console.error(error);
  }
}

function markPendingCheckin(guestId, checkedInAt) {
  const updatedAt = new Date().toISOString();
  state.pendingMutations[guestId] = {
    checkedInAt,
    updatedAt,
  };
  return updatedAt;
}

function markPendingReset(guestId) {
  const updatedAt = new Date().toISOString();
  state.pendingMutations[guestId] = {
    checkedInAt: null,
    updatedAt,
  };
  return updatedAt;
}

function mergeSheetCheckins(sheetCheckins) {
  const mergedCheckins = { ...sheetCheckins };

  Object.entries(state.pendingMutations).forEach(([guestId, mutation]) => {
    const sheetCheckin = sheetCheckins[guestId];

    if (mutation.checkedInAt && sheetCheckin?.checkedInAt === mutation.checkedInAt) {
      delete state.pendingMutations[guestId];
      return;
    }

    if (mutation.checkedInAt === null && !sheetCheckin) {
      delete state.pendingMutations[guestId];
      return;
    }

    if (mutation.checkedInAt) {
      mergedCheckins[guestId] = { checkedInAt: mutation.checkedInAt };
    } else {
      delete mergedCheckins[guestId];
    }
  });

  return mergedCheckins;
}

function requestSync(action, params = {}) {
  const callbackName = "guestlistSync";
  const url = new URL(syncConfig.endpoint);
  url.searchParams.set("action", action);
  url.searchParams.set("secret", syncConfig.secret);
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("_", Date.now().toString());

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return fetch(url.toString())
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Sync HTTP ${response.status}`);
      }
      return response.text();
    })
    .then((text) => parseSyncResponse(text, callbackName, action));
}

function parseSyncResponse(text, callbackName, action) {
  const prefix = `${callbackName}(`;
  const suffix = ")";

  if (!text.startsWith(prefix) || !text.endsWith(suffix)) {
    throw new Error(`Unexpected sync response: ${text.slice(0, 80)}`);
  }

  const response = JSON.parse(text.slice(prefix.length, -suffix.length));
  if (!response.ok) {
    throw new Error(response.error || `Sync request failed: ${action}`);
  }

  return response;
}

function makeGuestId(listId, lastName, firstName, index) {
  return `${listId}-${normalize(lastName)}-${normalize(firstName)}-${index}`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function formatTime(value) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
