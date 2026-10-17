import assert from "node:assert/strict";
import test from "node:test";
import { mapGuestRows, mergeCheckins } from "../guest-model.js";

const checkedInAt = "2026-10-02T18:00:00.000Z";

test("a guest id is scoped to its list", () => {
  const [guest] = mapGuestRows([{ id: "walk", Name: "Klein", Vorname: "Eva" }], "Skipliste");

  assert.equal(guest.displayName, "Eva Klein");
  assert.equal(guest.id, "Skipliste:walk");
  assert.equal(guest.sheetId, "walk");
});

test("a pending check-in shows until the sheet has it", () => {
  const [waiting] = mapGuestRows([{ id: "abc", Name: "Weber" }], "guestlist");
  const pending = { [waiting.id]: { checkedInAt } };

  assert.equal(mergeCheckins([waiting], pending)[waiting.id].checkedInAt, checkedInAt);
  assert.ok(pending[waiting.id]);

  const [confirmed] = mapGuestRows([{ id: "abc", Name: "Weber", checkedInAt }], "guestlist");
  assert.equal(mergeCheckins([confirmed], pending)[confirmed.id].checkedInAt, checkedInAt);
  assert.equal(pending[confirmed.id], undefined);
});

test("a pending reset hides the check-in until the sheet is cleared", () => {
  const [stillChecked] = mapGuestRows([{ id: "abc", Name: "Weber", checkedInAt }], "guestlist");
  const pending = { [stillChecked.id]: { checkedInAt: null } };

  assert.equal(mergeCheckins([stillChecked], pending)[stillChecked.id], undefined);
  assert.ok(pending[stillChecked.id]);

  const [cleared] = mapGuestRows([{ id: "abc", Name: "Weber" }], "guestlist");
  mergeCheckins([cleared], pending);
  assert.equal(pending[cleared.id], undefined);
});

test("a pending tap for a deleted row is dropped", () => {
  const pending = { "guestlist:gone": { checkedInAt } };
  assert.deepEqual(mergeCheckins([], pending), {});
  assert.deepEqual(pending, {});
});
