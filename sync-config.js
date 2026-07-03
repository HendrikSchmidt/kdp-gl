globalThis.GUESTLIST_SYNC_CONFIG = {
  endpoint: "https://script.google.com/macros/s/AKfycbxMKfFRpuP8vvTjhQAaIWkdroFQSr4QWnauPWObw64wP_6vh8AtMvrfU1_mqyk-xNWt4g/exec",
  // The access code is not stored here. Staff enter it in the app (or open a
  // per-event link like ?code=THE-CODE). It must match an entry in
  // ACCESS_CODES in google-apps-script.js.
  pollMs: 3000,
  // TXL in Concert (tomorrow): only the Skipliste is used for this event.
  // Revert to ["guestlist", "skiplist"] (or remove this line) for events
  // that use both lists.
  enabledLists: ["skiplist"],
};
