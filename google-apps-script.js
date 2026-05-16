const SHEET_NAME = "Checkins";
const GUEST_SHEET_NAME = "Gästeliste";
const SKIP_SHEET_NAME = "Skipliste";
const SHARED_SECRET = "change-me";

function setupCheckinsSheet() {
  getSheet();
}

function doGet(event) {
  const params = event.parameter || {};
  const callback = params.callback || "callback";

  try {
    if (params.secret !== SHARED_SECRET) {
      throw new Error("Unauthorized");
    }

    const action = params.action || "list";
    const sheet = getSheet();

    if (action === "checkin") {
      requireParam(params, "guestId");
      requireParam(params, "checkedInAt");
      upsertCheckin(sheet, params.guestId, params.checkedInAt, true, params.updatedAt);
      return jsonp(callback, { ok: true });
    }

    if (action === "reset") {
      requireParam(params, "guestId");
      upsertCheckin(sheet, params.guestId, "", false, params.updatedAt);
      return jsonp(callback, { ok: true });
    }

    if (action === "list") {
      return jsonp(callback, { ok: true, checkins: getActiveCheckins(sheet) });
    }

    if (action === "guests") {
      return jsonp(callback, { ok: true, guests: getGuests(params.list || GUEST_SHEET_NAME) });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    return jsonp(callback, { ok: false, error: error.message });
  }
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.appendRow(["guestId", "checkedInAt", "updatedAt", "active"]);
  }

  return sheet;
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

  const sourceSheet = spreadsheet.getSheets().find((sheet) => sheet.getName() !== SHEET_NAME && sheet.getName() !== SKIP_SHEET_NAME);
  if (!sourceSheet) {
    throw new Error(`Create a source tab named ${sheetName}`);
  }

  return sourceSheet;
}

function getGuests(sheetName) {
  const values = getGuestSheet(sheetName).getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  const headerEntries = values[0]
    .map((header, index) => ({ header: String(header).trim(), index }))
    .filter((entry) => entry.header);

  return values
    .slice(1)
    .filter((row) => row.some((cell) => String(cell).trim()))
    .map((row) => {
      return headerEntries.reduce((guest, { header, index }) => {
        guest[header] = formatCellValue(row[index]);
        return guest;
      }, {});
    });
}

function getActiveCheckins(sheet) {
  const values = sheet.getDataRange().getValues();
  const checkins = {};

  values.slice(1).forEach(([guestId, checkedInAt, , active]) => {
    if (guestId && active === true) {
      checkins[guestId] = {
        checkedInAt: formatValueDate(checkedInAt),
      };
    }
  });

  return checkins;
}

function upsertCheckin(sheet, guestId, checkedInAt, active, updatedAt) {
  const values = sheet.getDataRange().getValues();
  const now = parseDate(updatedAt) || new Date();

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (values[rowIndex][0] === guestId) {
      const previousUpdate = parseDate(values[rowIndex][2]);
      if (previousUpdate && previousUpdate > now) {
        return;
      }

      sheet.getRange(rowIndex + 1, 2, 1, 3).setValues([[checkedInAt, now, active]]);
      return;
    }
  }

  sheet.appendRow([guestId, checkedInAt, now, active]);
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

function formatValueDate(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function formatCellValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value || "").trim();
}

function parseDate(value) {
  if (value instanceof Date) {
    return value;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
