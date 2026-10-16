const GUEST_SHEET_NAME = "Gästeliste";
const SKIP_SHEET_NAME = "Skipliste";
const ID_HEADER = "ID";
const CHECKIN_HEADER = "Eingecheckt";
const NAME_ALIASES = ["name", "nachname", "lastname", "last name"];
const FIRST_ALIASES = ["vorname", "firstname", "first name"];
const STATUS_ALIASES = ["status"];
const CATEGORY_ALIASES = ["kategorie", "category"];
// One or more valid access codes. Add a new code per event and remove old ones
// to revoke access. Use long, unguessable values.
const ACCESS_CODES = ["change-me-to-a-real-code"];

function doGet(event) {
  const params = event.parameter || {};
  const callback = params.callback || "callback";

  try {
    if (!isAuthorized(params.secret)) {
      throw new Error("Unauthorized");
    }

    const action = params.action || "list";

    if (action === "list") {
      const guests = {};
      String(params.lists || GUEST_SHEET_NAME)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .forEach((name) => {
          guests[name] = getGuests(name);
        });
      return jsonp(callback, { ok: true, guests });
    }

    if (action === "checkin") {
      requireParam(params, "list");
      requireParam(params, "guestId");
      requireParam(params, "checkedInAt");
      setCheckin(params.list, params.guestId, params.checkedInAt);
      return jsonp(callback, { ok: true });
    }

    if (action === "reset") {
      requireParam(params, "list");
      requireParam(params, "guestId");
      setCheckin(params.list, params.guestId, "");
      return jsonp(callback, { ok: true });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    return jsonp(callback, { ok: false, error: error.message });
  }
}

function isAuthorized(secret) {
  return typeof secret === "string" && secret.length > 0 && ACCESS_CODES.indexOf(secret) !== -1;
}

function getGuestSheet(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const namedSheet = spreadsheet.getSheetByName(sheetName);

  if (namedSheet) {
    return namedSheet;
  }

  if (sheetName !== GUEST_SHEET_NAME) {
    throw new Error(`Create a source tab named ${sheetName}`);
  }

  const sourceSheet = spreadsheet.getSheets().find((sheet) => sheet.getName() !== SKIP_SHEET_NAME);
  if (!sourceSheet) {
    throw new Error(`Create a source tab named ${sheetName}`);
  }

  return sourceSheet;
}

function getGuests(sheetName) {
  const sheet = getGuestSheet(sheetName);
  const table = readTable(sheet, sheetName);
  if (!table.changed) {
    return table.guests;
  }

  return withLock(() => {
    const fresh = readTable(sheet, sheetName);
    if (fresh.changed) {
      writeColumns(sheet, fresh);
    }
    return fresh.guests;
  });
}

function setCheckin(sheetName, guestId, checkedInAt) {
  const sheet = getGuestSheet(sheetName);

  withLock(() => {
    const table = readTable(sheet, sheetName);
    if (table.changed) {
      writeColumns(sheet, table);
    }

    const guest = table.guests.find((item) => item.id === guestId);
    if (!guest) {
      throw new Error("Guest not found. The row may have been deleted.");
    }

    // A second device checking in the same guest keeps the first time.
    if (checkedInAt && guest.checkedInAt) {
      return;
    }

    const value = checkedInAt ? parseDate(checkedInAt) || checkedInAt : "";
    sheet.getRange(guest.rowNumber, table.checkinColumn + 1).setValue(value);
  });
}

function withLock(callback) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function readTable(sheet, sheetName) {
  const values = sheet.getDataRange().getValues();
  const headerRowIndex = findHeaderRowIndex(values);
  if (headerRowIndex < 0) {
    throw new Error(`Sheet "${sheetName}" needs a Name column`);
  }
  return buildTable(values, headerRowIndex, () => Utilities.getUuid());
}

function writeColumns(sheet, table) {
  [table.idColumn, table.checkinColumn].forEach((column) => {
    const cells = table.rows.map((row) => [row[column] ?? ""]);
    sheet.getRange(1, column + 1, cells.length, 1).setValues(cells);
  });
}

// Gives every guest row a permanent ID so check-ins stay attached when names
// are edited or rows are inserted and sorted.
function buildTable(values, headerRowIndex, createId) {
  const rows = values.map((row) => row.slice());
  const header = rows[headerRowIndex];
  let nextColumn = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let changed = false;

  const ensureColumn = (title) => {
    let index = findColumn(header, [title.toLowerCase()]);
    if (index === -1) {
      index = nextColumn;
      nextColumn += 1;
      header[index] = title;
      changed = true;
    }
    return index;
  };

  const idColumn = ensureColumn(ID_HEADER);
  const checkinColumn = ensureColumn(CHECKIN_HEADER);
  const columns = {
    Name: findColumn(header, NAME_ALIASES),
    Vorname: findColumn(header, FIRST_ALIASES),
    Status: findColumn(header, STATUS_ALIASES),
    Kategorie: findColumn(header, CATEGORY_ALIASES),
  };

  const seen = new Set();
  const guests = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    while (row.length < nextColumn) {
      row.push("");
    }

    const hasPerson = [columns.Name, columns.Vorname].some((index) => {
      return index !== -1 && String(row[index] ?? "").trim() !== "";
    });
    if (!hasPerson) {
      // Deleting a guest's name frees the row, so drop its ID and check-in too.
      if (String(row[idColumn] ?? "").trim() !== "" || String(row[checkinColumn] ?? "").trim() !== "") {
        row[idColumn] = "";
        row[checkinColumn] = "";
        changed = true;
      }
      continue;
    }

    let id = String(row[idColumn] ?? "").trim();

    if (!id || seen.has(id)) {
      // A copied row also copies the original guest's check-in.
      if (id) {
        row[checkinColumn] = "";
      }
      id = createId();
      row[idColumn] = id;
      changed = true;
    }
    seen.add(id);

    const guest = { id, rowNumber: rowIndex + 1, checkedInAt: formatCellValue(row[checkinColumn]) };
    Object.keys(columns).forEach((key) => {
      guest[key] = columns[key] === -1 ? "" : formatCellValue(row[columns[key]]);
    });
    guests.push(guest);
  }

  return { rows, guests, changed, idColumn, checkinColumn };
}

function findHeaderRowIndex(values) {
  const limit = Math.min(values.length, 15);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    if (findColumn(values[rowIndex], NAME_ALIASES) !== -1) {
      return rowIndex;
    }
  }
  return -1;
}

function findColumn(header, aliases) {
  const keys = header.map((cell) => String(cell ?? "").trim().toLowerCase());
  for (const alias of aliases) {
    const index = keys.indexOf(alias);
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

function requireParam(params, name) {
  if (!params[name]) {
    throw new Error(`Missing required parameter: ${name}`);
  }
}

function jsonp(callback, payload) {
  const safeCallback = String(callback).replace(/[^\w.$]/g, "");
  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(payload)})`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function formatCellValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
