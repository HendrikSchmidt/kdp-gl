export function clean(value) {
  return String(value ?? "").trim();
}

export function normalize(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function mapGuestRows(rows, listId) {
  return rows.map((row) => {
    const sheetId = clean(row.id);
    const lastName = clean(row.Name);
    const firstName = clean(row.Vorname);
    const nameless = !lastName && !firstName;

    return {
      id: `${listId}:${sheetId}`,
      sheetId,
      listId,
      lastName,
      firstName,
      status: clean(row.Status),
      category: clean(row.Kategorie),
      checkedInAt: clean(row.checkedInAt),
      rowNumber: Number(row.rowNumber) || null,
      nameless,
      displayName: [firstName, lastName].filter(Boolean).join(" ") || "Ohne Namen",
    };
  });
}

// Taps that the sheet has not confirmed yet win over the sheet state, so a
// poll that started before the tap does not undo it on screen.
export function mergeCheckins(guests, pendingMutations) {
  const checkins = {};
  guests.forEach((guest) => {
    if (guest.checkedInAt) {
      checkins[guest.id] = { checkedInAt: guest.checkedInAt };
    }
  });

  const guestIds = new Set(guests.map((guest) => guest.id));
  Object.entries(pendingMutations).forEach(([guestId, mutation]) => {
    const confirmed = mutation.checkedInAt ? Boolean(checkins[guestId]) : !checkins[guestId];
    if (confirmed || !guestIds.has(guestId)) {
      delete pendingMutations[guestId];
      return;
    }

    if (mutation.checkedInAt) {
      checkins[guestId] = { checkedInAt: mutation.checkedInAt };
    } else {
      delete checkins[guestId];
    }
  });

  return checkins;
}
