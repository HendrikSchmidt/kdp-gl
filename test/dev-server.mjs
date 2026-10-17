import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createSheet, createSpreadsheet, loadAppsScript } from "./sheet-harness.mjs";

const root = new URL("..", import.meta.url);
const port = Number(process.env.PORT || 8765);
const sheets = {
  Gästeliste: createSheet([
    ["Sommerfest"],
    ["Name", "Vorname", "Status", "Kategorie"],
    ["Müller", "", "VIP", ""],
    ["Weber", "Anna", "Guest", "A"],
  ]),
  Skipliste: createSheet([
    ["Name", "Vorname", "Status"],
    ["", "", "Walk-up"],
    ["Klein", "Eva", "Skip"],
  ]),
};
sheets.Gästeliste.name = "Gästeliste";
sheets.Skipliste.name = "Skipliste";

const api = loadAppsScript();
api.setSpreadsheet(createSpreadsheet(sheets));

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

function headerIndex(sheet, column) {
  const rowIndex = sheet._rows.findIndex((row) =>
    row.some((cell) => ["name", "nachname"].includes(String(cell).trim().toLowerCase())),
  );
  const header = sheet._rows[rowIndex].map((cell) => String(cell).trim().toLowerCase());
  return { rowIndex, column: header.indexOf(column.toLowerCase()) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (url.pathname === "/exec") {
    const params = Object.fromEntries(url.searchParams.entries());
    const result = api.doGet(params);
    const body = `guestlistSync(${JSON.stringify(result)})`;
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
    return;
  }

  if (url.pathname === "/test/update" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const sheet = sheets[body.sheet];
    const { column } = headerIndex(sheet, body.column);
    sheet._rows[body.rowNumber - 1][column] = body.value;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rows: sheet._rows }));
    return;
  }

  if (url.pathname === "/test/insert" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    sheets[body.sheet]._rows.splice(body.rowNumber - 1, 0, body.values);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/sync-config.js") {
    const body = `globalThis.GUESTLIST_SYNC_CONFIG = ${JSON.stringify({
      endpoint: `http://127.0.0.1:${port}/exec`,
      pollMs: 400,
    })};\n`;
    res.writeHead(200, { "content-type": types[".js"], "cache-control": "no-store" });
    res.end(body);
    return;
  }

  const filePath = path.join(root.pathname, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(root.pathname) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(filePath)] || "text/plain", "cache-control": "no-store" });
  res.end(fs.readFileSync(filePath));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`guest list dev server http://127.0.0.1:${port}`);
});
