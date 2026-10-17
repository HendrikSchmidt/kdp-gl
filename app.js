import { clean, mapGuestRows, mergeCheckins, normalize } from "./guest-model.js";

const storageKey = "vip-guestlist-checkins-v1";
const accessCodeKey = "vip-guestlist-access-code-v1";
const configuredSync = globalThis.GUESTLIST_SYNC_CONFIG;
const defaultSyncConfig = {
  endpoint: "",
  secret: "",
  pollMs: 3000,
};
const syncConfig = configuredSync ? { ...defaultSyncConfig, ...configuredSync } : defaultSyncConfig;

// Lists are the sheet's tabs, keyed by tab name. listIds keeps the tab order.
const state = {
  activeListId: "",
  listIds: [],
  lists: {},
  checkins: readCheckins(),
  pendingMutations: {},
  query: "",
  syncStatus: "Syncing...",
  syncTone: "pending",
};

let latestAppliedSyncRun = 0;
let appStarted = false;
let renderedGuestListHtml = "";
let renderedListTabsHtml = "";

const elements = {
  checkedCount: document.querySelector("#checked-count"),
  syncStatus: document.querySelector("#sync-status"),
  totalCount: document.querySelector("#total-count"),
  listTitle: document.querySelector("#list-title"),
  progressFill: document.querySelector("#progress-fill"),
  clearSearch: document.querySelector("#clear-search"),
  toolbar: document.querySelector("#toolbar"),
  toolbarSentinel: document.querySelector("#toolbar-sentinel"),
  detailStatus: document.querySelector("#detail-status"),
  detailTime: document.querySelector("#detail-time"),
  detailTitle: document.querySelector("#detail-title"),
  detailView: document.querySelector("#detail-view"),
  emptyState: document.querySelector("#empty-state"),
  guestList: document.querySelector("#guest-list"),
  listTabsNav: document.querySelector("#list-tabs-nav"),
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

  elements.clearSearch.addEventListener("click", () => {
    state.query = "";
    elements.search.value = "";
    elements.search.focus();
    render();
  });

  elements.listTabsNav.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-list-tab]");
    if (!tab) return;

    state.activeListId = tab.dataset.listTab;
    state.query = "";
    elements.search.value = "";
    location.hash = "";
    render();
  });

  new IntersectionObserver(([entry]) => {
    elements.toolbar.classList.toggle("is-stuck", !entry.isIntersecting);
  }).observe(elements.toolbarSentinel);

  elements.guestList.addEventListener("click", (event) => {
    const checkButton = event.target.closest("[data-check-id]");
    const guestCard = event.target.closest("[data-guest-id]");

    if (checkButton) {
      toggleGuest(checkButton.dataset.checkId);
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

  elements.detailView.addEventListener("click", (event) => {
    if (event.target === elements.detailView) {
      location.hash = "";
    }
  });

  globalThis.addEventListener("hashchange", renderRoute);
}

async function fetchSnapshot() {
  const response = await requestSync("list");
  if (!response.lists) {
    throw new Error("The Apps Script is out of date. Deploy the current google-apps-script.js.");
  }

  return response.lists.map(({ name, guests }) => ({ id: name, guests: mapGuestRows(guests, name) }));
}

function applySnapshot(lists) {
  state.listIds = lists.map((list) => list.id);
  state.lists = Object.fromEntries(lists.map((list) => [list.id, list.guests]));
  if (!state.listIds.includes(state.activeListId)) {
    state.activeListId = state.listIds[0] || "";
  }
  state.checkins = mergeCheckins(getAllGuests(), state.pendingMutations);
  setSyncStatus(`Synced ${formatTime(new Date().toISOString())}`, "ok");
  writeCheckins();
}

function setSyncStatus(text, tone) {
  state.syncStatus = text;
  state.syncTone = tone;
}

function render() {
  const filteredGuests = getFilteredGuests();
  const activeGuests = getActiveGuests();
  const checkedCount = Object.keys(state.checkins).filter((id) => activeGuests.some((guest) => guest.id === id)).length;

  elements.checkedCount.textContent = checkedCount;
  elements.totalCount.textContent = activeGuests.length;
  elements.progressFill.style.width = `${activeGuests.length ? (checkedCount / activeGuests.length) * 100 : 0}%`;
  elements.syncStatus.textContent = state.syncStatus;
  elements.syncStatus.dataset.tone = state.syncTone;
  elements.listTitle.textContent = state.activeListId || "Check-In";
  elements.clearSearch.classList.toggle("hidden", !state.query);
  renderListTabs();
  elements.emptyState.classList.toggle("hidden", filteredGuests.length > 0);
  // Replacing the cards on every poll can swallow a tap that is in progress.
  const guestListHtml = filteredGuests.map(renderGuest).join("");
  if (guestListHtml !== renderedGuestListHtml) {
    elements.guestList.innerHTML = guestListHtml;
    renderedGuestListHtml = guestListHtml;
  }
}

function renderListTabs() {
  // A single list is already named in the title, so there is nothing to switch.
  elements.listTabsNav.classList.toggle("hidden", state.listIds.length < 2);
  const listTabsHtml = state.listIds
    .map((listId) => {
      const isActive = listId === state.activeListId;
      return `<button class="list-tab${isActive ? " active" : ""}" type="button" aria-pressed="${isActive}" data-list-tab="${escapeHtml(listId)}">${escapeHtml(listId)}</button>`;
    })
    .join("");
  if (listTabsHtml !== renderedListTabsHtml) {
    elements.listTabsNav.innerHTML = listTabsHtml;
    renderedListTabsHtml = listTabsHtml;
  }
}

function renderGuest(guest) {
  const checkin = state.checkins[guest.id];
  const checked = Boolean(checkin);
  const meta = [guest.status, guest.category].filter(Boolean);

  return `
    <li class="guest-row${checked ? " checked-in" : ""}" data-guest-id="${escapeHtml(guest.id)}">
      <button class="check-button" type="button" data-check-id="${escapeHtml(guest.id)}" aria-label="${checked ? "Details for" : "Check in"} ${escapeHtml(guest.displayName)}">
        <span class="check-circle"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg></span>
      </button>
      <div class="guest-main">
        <p class="guest-name">${escapeHtml(guest.displayName)}</p>
        ${meta.length ? `<p class="guest-meta">${meta.map(escapeHtml).join(" · ")}</p>` : ""}
      </div>
      ${checked ? `<span class="guest-time">${escapeHtml(formatTime(checkin.checkedInAt))}</span>` : ""}
    </li>
  `;
}

function renderRoute() {
  const guestId = getRouteGuestId();
  const guest = getAllGuests().find((item) => item.id === guestId);
  const checkin = guest ? state.checkins[guest.id] : null;

  if (!guest || !checkin) {
    elements.detailView.classList.add("hidden");
    document.body.classList.remove("sheet-open");
    return;
  }

  elements.detailTitle.textContent = guest.displayName;
  elements.detailTime.textContent = formatDateTime(checkin.checkedInAt);
  elements.detailStatus.textContent = [guest.listId, guest.status, guest.category].filter(Boolean).join(" · ") || "VIP";
  elements.detailView.classList.remove("hidden");
  document.body.classList.add("sheet-open");
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
    setSyncStatus("Offline, saved on this phone", "error");
    render();
    console.error(error);
  }
}

async function syncGuestCheckin(guest, checkedInAt) {
  try {
    await requestSync("checkin", { list: guest.listId, guestId: guest.sheetId, checkedInAt });
    setSyncStatus("Sync pending", "pending");
    render();
  } catch (error) {
    setSyncStatus("Sync pending", "pending");
    render();
    console.error(error);
  }
}

async function syncGuestReset(guest) {
  try {
    await requestSync("reset", { list: guest.listId, guestId: guest.sheetId });
    setSyncStatus("Sync pending", "pending");
    render();
  } catch (error) {
    setSyncStatus("Sync pending", "pending");
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
