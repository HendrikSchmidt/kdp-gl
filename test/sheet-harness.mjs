import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const SECRET = "change-me-to-a-real-code";

export function createSheet(rows) {
  const data = rows.map((row) => row.slice());

  return {
    _rows: data,
    getName() {
      return this.name || "";
    },
    isSheetHidden() {
      return Boolean(this.hidden);
    },
    getDataRange() {
      return {
        getValues() {
          return data.map((row) => row.slice());
        },
      };
    },
    getRange(row, column, numRows, numCols) {
      const height = numRows == null ? 1 : numRows;
      const width = numCols == null ? 1 : numCols;
      return {
        getValues() {
          const out = [];
          for (let r = 0; r < height; r += 1) {
            const source = data[row - 1 + r] || [];
            const line = [];
            for (let c = 0; c < width; c += 1) {
              line.push(source[column - 1 + c] ?? "");
            }
            out.push(line);
          }
          return out;
        },
        setValues(grid) {
          for (let r = 0; r < grid.length; r += 1) {
            const target = row - 1 + r;
            while (data.length <= target) {
              data.push([]);
            }
            const line = data[target];
            for (let c = 0; c < grid[r].length; c += 1) {
              line[column - 1 + c] = grid[r][c];
            }
          }
        },
        setValue(value) {
          this.setValues([[value]]);
        },
      };
    },
    appendRow(row) {
      data.push(row.slice());
    },
  };
}

export function createSpreadsheet(sheets, name = "") {
  return {
    getName() {
      return name;
    },
    getSheetByName(name) {
      return sheets[name] || null;
    },
    insertSheet(name) {
      const sheet = createSheet([]);
      sheet.name = name;
      sheets[name] = sheet;
      return sheet;
    },
    getSheets() {
      return Object.entries(sheets).map(([name, sheet]) => {
        sheet.name = name;
        return sheet;
      });
    },
  };
}

export function loadAppsScript() {
  const source = fs.readFileSync(new URL("../google-apps-script.js", import.meta.url), "utf8");
  let spreadsheet = null;
  const context = {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return spreadsheet;
      },
    },
    LockService: {
      getDocumentLock() {
        return {
          waitLock() {},
          releaseLock() {},
        };
      },
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
    },
    ContentService: {
      MimeType: { JAVASCRIPT: "application/javascript" },
      createTextOutput(text) {
        const output = {
          text,
          setMimeType() {
            return output;
          },
        };
        return output;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.__api = { doGet };\n`, context);

  return {
    secret: SECRET,
    setSpreadsheet(next) {
      spreadsheet = next;
    },
    doGet(params) {
      const result = context.__api.doGet({
        parameter: { secret: SECRET, callback: "guestlistSync", ...params },
      });
      const text = result.text;
      const json = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
      return JSON.parse(json);
    },
  };
}
