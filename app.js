import { clean, mapGuestRows, mergeCheckins, normalize } from "./guest-model.js";

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
let renderedGuestListHtml = "";

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
    applySnapshot(await fetchSnapshot());

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

    const guest = findGuest(guestId);
    if (!guest) return;

    markPendingReset(guestId);
    delete state.checkins[guestId];
    writeCheckins();
    location.hash = "";
    render();
    await syncGuestReset(guest);
  });

  document.querySelector("#close-detail").addEventListener("click", () => {
    location.hash = "";
  });

  globalThis.addEventListener("hashchange", renderRoute);
}

async function fetchSnapshot() {
  const sheetNames = Object.values(listConfigs).map((config) => config.sheetName);
  const response = await requestSync("list", { lists: sheetNames.join(",") });
  if (!response.guests) {
    throw new Error("The Apps Script is out of date. Deploy the current google-apps-script.js.");
  }

  return Object.fromEntries(
    Object.entries(listConfigs).map(([listId, config]) => {
      return [listId, mapGuestRows(response.guests[config.sheetName] || [], listId)];
    }),
  );
}

function applySnapshot(lists) {
  state.lists = lists;
  state.checkins = mergeCheckins(getAllGuests(), state.pendingMutations);
  state.syncStatus = `Synced ${formatTime(new Date().toISOString())}`;
  writeCheckins();
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
  // Replacing the cards on every poll can swallow a tap that is in progress.
  const guestListHtml = filteredGuests.map(renderGuest).join("");
  if (guestListHtml !== renderedGuestListHtml) {
    elements.guestList.innerHTML = guestListHtml;
    renderedGuestListHtml = guestListHtml;
  }
}

function renderGuest(guest) {
  const checkin = state.checkins[guest.id];
  const checked = Boolean(checkin);
  const meta = [guest.status, guest.category].filter(Boolean);
  const rowLabel = guest.nameless ? (guest.rowNumber ? `Zeile ${guest.rowNumber}` : "unvollständig") : "";

  return `
    <li class="guest-card ${checked ? "checked-in" : ""}" data-guest-id="${escapeHtml(guest.id)}">
      <button class="check-button" type="button" data-check-id="${escapeHtml(guest.id)}" aria-label="${checked ? "Reset" : "Check in"} ${escapeHtml(guest.displayName)}">
        ${checked ? "✓" : ""}
      </button>
      <div class="guest-main">
        <p class="guest-name${guest.nameless ? " placeholder" : ""}">${escapeHtml(guest.displayName)}</p>
        <div class="guest-meta">
          ${rowLabel ? `<span class="pill warning">${escapeHtml(rowLabel)}</span>` : ""}
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

  const guest = findGuest(guestId);
  if (!guest) return;

  const checkedInAt = new Date().toISOString();
  markPendingCheckin(guestId, checkedInAt);
  state.checkins[guestId] = {
    checkedInAt,
  };
  writeCheckins();
  render();
  await syncGuestCheckin(guest, checkedInAt);
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

function findGuest(guestId) {
  return getAllGuests().find((guest) => guest.id === guestId);
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
    const lists = await fetchSnapshot();
    if (syncRun < latestAppliedSyncRun) {
      return;
    }
    latestAppliedSyncRun = syncRun;
    applySnapshot(lists);
    render();
    renderRoute();
  } catch (error) {
    state.syncStatus = "Sync unavailable, using local state";
    render();
    console.error(error);
  }
}

async function syncGuestCheckin(guest, checkedInAt) {
  try {
    await requestSync("checkin", { list: listConfigs[guest.listId].sheetName, guestId: guest.sheetId, checkedInAt });
    state.syncStatus = "Sync pending";
    render();
  } catch (error) {
    state.syncStatus = "Sync pending";
    render();
    console.error(error);
  }
}

async function syncGuestReset(guest) {
  try {
    await requestSync("reset", { list: listConfigs[guest.listId].sheetName, guestId: guest.sheetId });
    state.syncStatus = "Sync pending";
    render();
  } catch (error) {
    state.syncStatus = "Sync pending";
    render();
    console.error(error);
  }
}

function markPendingCheckin(guestId, checkedInAt) {
  state.pendingMutations[guestId] = { checkedInAt };
}

function markPendingReset(guestId) {
  state.pendingMutations[guestId] = { checkedInAt: null };
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

function formatTime(value) {
  return formatDate(value, { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  return formatDate(value, { dateStyle: "medium", timeStyle: "short" });
}

// The Eingecheckt cell can hold hand-typed text such as "x".
function formatDate(value, options) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return clean(value);
  }
  return new Intl.DateTimeFormat("de-DE", options).format(date);
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
