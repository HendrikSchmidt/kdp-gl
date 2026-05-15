const csvCandidates = [
  "Ga%CC%88steliste%201605.csv",
  "G%C3%A4steliste%201605.csv",
  "Gästeliste 1605.csv",
];

const storageKey = "vip-guestlist-checkins-v1";

const state = {
  guests: [],
  checkins: readCheckins(),
  query: "",
};

const elements = {
  checkedCount: document.querySelector("#checked-count"),
  totalCount: document.querySelector("#total-count"),
  detailStatus: document.querySelector("#detail-status"),
  detailTime: document.querySelector("#detail-time"),
  detailTitle: document.querySelector("#detail-title"),
  detailView: document.querySelector("#detail-view"),
  emptyState: document.querySelector("#empty-state"),
  guestList: document.querySelector("#guest-list"),
  loading: document.querySelector("#loading"),
  resetGuest: document.querySelector("#reset-guest"),
  search: document.querySelector("#search"),
};

await init();

async function init() {
  try {
    const csvText = await loadCsv();
    state.guests = parseCsv(csvText).map((row, index) => {
      const lastName = clean(row.Name);
      const firstName = clean(row.Vorname);
      const status = clean(row.Status);
      const category = clean(row.Kategorie);

      return {
        id: makeGuestId(lastName, firstName, index),
        lastName,
        firstName,
        status,
        category,
        displayName: [firstName, lastName].filter(Boolean).join(" "),
      };
    });

    elements.loading.classList.add("hidden");
    elements.totalCount.textContent = state.guests.length;
    bindEvents();
    render();
    renderRoute();
  } catch (error) {
    elements.loading.textContent = "Could not load the guest list. Run this from a local server or GitHub Pages.";
    console.error(error);
  }
}

function bindEvents() {
  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
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

  elements.resetGuest.addEventListener("click", () => {
    const guestId = getRouteGuestId();
    if (!guestId) return;

    delete state.checkins[guestId];
    writeCheckins();
    location.hash = "";
    render();
  });

  document.querySelector("#close-detail").addEventListener("click", () => {
    location.hash = "";
  });

  globalThis.addEventListener("hashchange", renderRoute);
}

function loadCsv() {
  return csvCandidates.reduce((promise, candidate) => {
    return promise.catch(async () => {
      const response = await fetch(candidate);
      if (!response.ok) {
        throw new Error(`Failed to load ${candidate}`);
      }
      return response.text();
    });
  }, Promise.reject(new Error("No CSV candidates configured")));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const headerEntries = rows
    .shift()
    .map((header, index) => ({ header: header.trim(), index }))
    .filter((entry) => entry.header);

  return rows
    .filter((csvRow) => csvRow.some((cell) => clean(cell)))
    .map((csvRow) => {
      return headerEntries.reduce((result, { header, index }) => {
        result[header] = csvRow[index] ?? "";
        return result;
      }, {});
    });
}

function render() {
  const filteredGuests = getFilteredGuests();
  const checkedCount = Object.keys(state.checkins).filter((id) => state.guests.some((guest) => guest.id === id)).length;

  elements.checkedCount.textContent = checkedCount;
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
  const guest = state.guests.find((item) => item.id === guestId);
  const checkin = guest ? state.checkins[guest.id] : null;

  if (!guest || !checkin) {
    elements.detailView.classList.add("hidden");
    return;
  }

  elements.detailTitle.textContent = guest.displayName;
  elements.detailTime.textContent = formatDateTime(checkin.checkedInAt);
  elements.detailStatus.textContent = [guest.status, guest.category].filter(Boolean).join(" · ") || "VIP";
  elements.detailView.classList.remove("hidden");
}

function toggleGuest(guestId) {
  if (state.checkins[guestId]) {
    location.hash = `guest=${encodeURIComponent(guestId)}`;
    renderRoute();
    return;
  }

  state.checkins[guestId] = {
    checkedInAt: new Date().toISOString(),
  };
  writeCheckins();
  render();
}

function openDetail(guestId) {
  location.hash = `guest=${encodeURIComponent(guestId)}`;
}

function getFilteredGuests() {
  const normalizedQuery = normalize(state.query);

  if (!normalizedQuery) {
    return state.guests;
  }

  return state.guests.filter((guest) => {
    return normalize([guest.displayName, guest.lastName, guest.firstName, guest.status, guest.category].join(" ")).includes(normalizedQuery);
  });
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

function makeGuestId(lastName, firstName, index) {
  return `${normalize(lastName)}-${normalize(firstName)}-${index}`;
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
