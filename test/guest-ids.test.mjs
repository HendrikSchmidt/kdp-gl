import assert from "node:assert/strict";
import test from "node:test";
import { mapGuestRows } from "../guest-model.js";
import { createSheet, createSpreadsheet, loadAppsScript } from "./sheet-harness.mjs";

const checkedInAt = "2026-10-02T18:00:00.000Z";

function setup(guestRows) {
  const sheets = {
    Gästeliste: createSheet(guestRows),
    Skipliste: createSheet([
      ["Name", "Vorname", "Status"],
      ["Klein", "Eva", "Skip"],
    ]),
  };
  sheets.Gästeliste.name = "Gästeliste";
  sheets.Skipliste.name = "Skipliste";

  const api = loadAppsScript();
  api.setSpreadsheet(createSpreadsheet(sheets));
  return { api, rows: sheets.Gästeliste._rows };
}

function guests(api) {
  const response = api.doGet({ action: "list", lists: "Gästeliste,Skipliste" });
  assert.equal(response.ok, true, response.error);
  return mapGuestRows(response.guests.Gästeliste, "guestlist");
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

test("a nameless row under a title row keeps its check-in after the name is filled in", () => {
  const { api, rows } = setup([
    ["Sommerfest"],
    ["Name", "Vorname", "Status"],
    ["", "", "Walk-up"],
  ]);

  const [guest] = guests(api);
  assert.equal(guest.nameless, true);
  assert.equal(guest.rowNumber, 3);
  checkIn(api, guest);

  rows[2][0] = "Schmidt";
  rows[2][1] = "Lena";

  const [named] = guests(api);
  assert.equal(named.id, guest.id);
  assert.equal(named.displayName, "Lena Schmidt");
  assert.equal(named.checkedInAt, checkedInAt);
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

test("a sheet without a name column fails instead of returning a blank list", () => {
  const { api } = setup([["Notiz", "Plus"], ["x", "y"]]);
  const response = api.doGet({ action: "list", lists: "Gästeliste" });
  assert.equal(response.ok, false);
  assert.match(response.error, /Name column/);
});
