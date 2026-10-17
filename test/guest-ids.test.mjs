import assert from "node:assert/strict";
import test from "node:test";
import { mapGuestRows } from "../guest-model.js";
import { createSheet, createSpreadsheet, loadAppsScript } from "./sheet-harness.mjs";

const checkedInAt = "2026-10-02T18:00:00.000Z";

function setup(guestRows, extraSheets = {}) {
  const sheets = {
    Gästeliste: createSheet(guestRows),
    Skipliste: createSheet([
      ["Name", "Vorname", "Status"],
      ["Klein", "Eva", "Skip"],
    ]),
    ...extraSheets,
  };

  const api = loadAppsScript();
  api.setSpreadsheet(createSpreadsheet(sheets));
  return { api, sheets, rows: sheets.Gästeliste._rows };
}

function lists(api) {
  const response = api.doGet({ action: "list" });
  assert.equal(response.ok, true, response.error);
  return response.lists;
}

function guests(api) {
  const list = lists(api).find((item) => item.name === "Gästeliste");
  return mapGuestRows(list.guests, list.name);
}

function checkIn(api, guest, time = checkedInAt) {
  return api.doGet({ action: "checkin", list: "Gästeliste", guestId: guest.sheetId, checkedInAt: time });
}

test("the script adds ID and Eingecheckt columns and fills in ids", () => {
  const { api, rows } = setup([
    ["Name", "Vorname"],
    ["Weber", "Anna"],
  ]);

  const [guest] = guests(api);
  assert.deepEqual(rows[0], ["Name", "Vorname", "ID", "Eingecheckt"]);
  assert.equal(rows[1][2], guest.sheetId);
  assert.ok(guest.sheetId);
  assert.equal(guest.checkedInAt, "");
});

test("a check-in is written into the guest row", () => {
  const { api, rows } = setup([
    ["Name", "Vorname"],
    ["Weber", "Anna"],
  ]);

  const [guest] = guests(api);
  assert.equal(checkIn(api, guest).ok, true);
  assert.equal(rows[1][3].toISOString(), checkedInAt);
  assert.equal(guests(api)[0].checkedInAt, checkedInAt);
});

test("filling a first name and inserting a walk-up keeps the check-in", () => {
  const { api, rows } = setup([
    ["Name", "Vorname", "Status"],
    ["Müller", "", "VIP"],
    ["Weber", "Anna", "VIP"],
  ]);

  const mueller = guests(api).find((guest) => guest.lastName === "Müller");
  checkIn(api, mueller);

  rows[1][1] = "Hans";
  rows.splice(1, 0, ["Neu", "Gast", "Walk-up"]);

  const after = guests(api);
  const stillMueller = after.find((guest) => guest.lastName === "Müller");
  const walkUp = after.find((guest) => guest.lastName === "Neu");
  assert.equal(stillMueller.id, mueller.id);
  assert.equal(stillMueller.displayName, "Hans Müller");
  assert.equal(stillMueller.checkedInAt, checkedInAt);
  assert.equal(walkUp.checkedInAt, "");
  assert.notEqual(walkUp.id, mueller.id);
});

test("sorting the sheet keeps each check-in on its guest", () => {
  const { api, rows } = setup([
    ["Name", "Vorname"],
    ["Adler", "Ben"],
    ["Zander", "Lea"],
  ]);

  const zander = guests(api).find((guest) => guest.lastName === "Zander");
  checkIn(api, zander);
  rows.splice(1, 2, rows[2], rows[1]);

  const [first, second] = guests(api);
  assert.equal(first.lastName, "Zander");
  assert.equal(first.checkedInAt, checkedInAt);
  assert.equal(second.checkedInAt, "");
});

test("a check-in made after a row was inserted lands on the right guest", () => {
  const { api, rows } = setup([
    ["Name", "Vorname"],
    ["Weber", "Anna"],
  ]);

  const [weber] = guests(api);
  rows.splice(1, 0, ["Neu", "Gast"]);
  checkIn(api, weber);

  const after = guests(api);
  assert.equal(after.find((guest) => guest.lastName === "Weber").checkedInAt, checkedInAt);
  assert.equal(after.find((guest) => guest.lastName === "Neu").checkedInAt, "");
});

test("a copied row gets a new id and does not copy the check-in", () => {
  const { api, rows } = setup([
    ["Name", "Vorname"],
    ["Müller", "Hans"],
  ]);

  const [original] = guests(api);
  checkIn(api, original);
  rows.push(rows[1].slice());

  const [first, copy] = guests(api);
  assert.equal(first.id, original.id);
  assert.equal(first.checkedInAt, checkedInAt);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.checkedInAt, "");
});

test("a second check-in keeps the first time and reset clears it", () => {
  const { api } = setup([
    ["Name", "Vorname"],
    ["Weber", "Anna"],
  ]);

  const [guest] = guests(api);
  checkIn(api, guest);
  checkIn(api, guest, "2026-10-02T19:00:00.000Z");
  assert.equal(guests(api)[0].checkedInAt, checkedInAt);

  const reset = api.doGet({ action: "reset", list: "Gästeliste", guestId: guest.sheetId });
  assert.equal(reset.ok, true);
  assert.equal(guests(api)[0].checkedInAt, "");
});

test("checking in a deleted row fails instead of hitting another guest", () => {
  const { api, rows } = setup([
    ["Name", "Vorname"],
    ["Weber", "Anna"],
    ["Klein", "Eva"],
  ]);

  const [weber] = guests(api);
  rows.splice(1, 1);

  const response = checkIn(api, weber);
  assert.equal(response.ok, false);
  assert.match(response.error, /not found/);
  assert.equal(guests(api)[0].checkedInAt, "");
});

test("a row needs a Name or Vorname to be a guest", () => {
  const { api } = setup([
    ["Sommerfest"],
    ["Name", "Vorname", "Status"],
    ["", "", "Walk-up"],
    ["", "Lena", ""],
    ["Schmidt", "", ""],
  ]);

  assert.deepEqual(guests(api).map((guest) => guest.displayName), ["Lena", "Schmidt"]);
});

test("deleting a guest's name drops the row's ID and check-in", () => {
  const { api, rows } = setup([
    ["Sommerfest"],
    ["Name", "Vorname", "Status"],
    ["Schmidt", "Lena", "VIP"],
  ]);

  const [guest] = guests(api);
  checkIn(api, guest);
  rows[2][0] = "";
  rows[2][1] = "";

  assert.deepEqual(guests(api), []);
  assert.deepEqual(rows[2], ["", "", "VIP", "", ""]);
});

test("a hand-typed mark in Eingecheckt counts as checked in", () => {
  const { api, rows } = setup([
    ["Name", "Vorname", "Eingecheckt"],
    ["Weber", "Anna", "x"],
  ]);

  assert.equal(guests(api)[0].checkedInAt, "x");
  assert.equal(rows[0].indexOf("Eingecheckt"), 2);
});

test("Nachname is accepted as the last-name column", () => {
  const { api } = setup([
    ["Nachname", "Vorname", "Kategorie"],
    ["Schmidt", "Lena", "A"],
  ]);

  const [guest] = guests(api);
  assert.equal(guest.lastName, "Schmidt");
  assert.equal(guest.firstName, "Lena");
  assert.equal(guest.category, "A");
});

test("every visible tab with a Name column becomes a list, in tab order", () => {
  const notes = createSheet([["Notiz", "Plus"], ["x", "y"]]);
  const backstage = createSheet([["Nachname"], ["Roth"]]);
  const archive = createSheet([["Name"], ["Alt"]]);
  archive.hidden = true;
  const { api, sheets } = setup([["Name"], ["Weber"]], { Notizen: notes, Backstage: backstage, Archiv: archive });

  assert.deepEqual(lists(api).map((list) => list.name), ["Gästeliste", "Skipliste", "Backstage"]);
  assert.deepEqual(sheets.Notizen._rows, [["Notiz", "Plus"], ["x", "y"]]);
});

test("a sheet with only Skipliste works without a Gästeliste tab", () => {
  const skip = createSheet([["Name", "Vorname"], ["Klein", "Eva"]]);
  const api = loadAppsScript();
  api.setSpreadsheet(createSpreadsheet({ Skipliste: skip }));

  const [list] = lists(api);
  assert.equal(list.name, "Skipliste");
  const [guest] = mapGuestRows(list.guests, list.name);
  const response = api.doGet({ action: "checkin", list: "Skipliste", guestId: guest.sheetId, checkedInAt });
  assert.equal(response.ok, true, response.error);
});

test("a sheet without any Name column fails instead of returning no lists", () => {
  const api = loadAppsScript();
  api.setSpreadsheet(createSpreadsheet({ Notizen: createSheet([["Notiz", "Plus"], ["x", "y"]]) }));
  const response = api.doGet({ action: "list" });
  assert.equal(response.ok, false);
  assert.match(response.error, /Name column/);
});

test("checking in on a tab that was renamed fails", () => {
  const { api } = setup([["Name"], ["Weber"]]);
  const [guest] = guests(api);
  const response = api.doGet({ action: "checkin", list: "Gaesteliste", guestId: guest.sheetId, checkedInAt });
  assert.equal(response.ok, false);
  assert.match(response.error, /no longer exists/);
});
