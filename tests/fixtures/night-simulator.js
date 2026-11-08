function installNightSimulatorFixture() {
  const page = getCurrentPages().slice(-1)[0];
  if (!page.controller) throw new Error("Open tonight first");
  const store = page.controller.store;
  const fixture = { userId: "local-simulator-fixture", nightId: "20261107", now: Date.parse("2026-11-07T22:30:00+08:00"), record: null, pending: null, phase: "open", mode: "normal", calls: [],
    prefs: { sound: false, haptics: true, reduceMotion: false },
    phrase: "这是一句用于排版检查的长句。".repeat(3).slice(0, 40) };
  getApp().__nightFixture = fixture;
  store.persistence = {
    getPending: () => fixture.pending,
    setPending: (_uid, nightId) => { fixture.pending = nightId; }
  };
  // Keep the shared API object's identity: the event queue also uses it.
  // This prevents visual test events from being sent to the real account.
  const originalApi = { ...store.api };
  const api = {
    getState: async () => {
      fixture.calls.push("getState");
      return { userId: fixture.userId, serverNow: fixture.now, nightId: fixture.nightId, phase: fixture.phase,
        windowOpenAt: Date.parse("2026-11-07T20:00:00+08:00"), windowCloseAt: Date.parse("2026-11-08T06:00:00+08:00"), nextOpenAt: Date.parse("2026-11-08T20:00:00+08:00"),
        record: fixture.record, lastRecord: fixture.record, firstNightId: fixture.record ? fixture.nightId : null, lastNightId: fixture.record ? fixture.nightId : null, prefs: { ...fixture.prefs } };
    },
    closeLight: async (nightId, method) => {
      fixture.calls.push("closeLight:" + nightId);
      if (fixture.mode === "unknown") throw new Error("Simulated unavailable acknowledgement");
      const created = !fixture.record;
      if (!fixture.record) fixture.record = { nightId, confirmedAt: fixture.now, method, phraseId: "layout-only", phraseText: fixture.phrase, phraseVersion: 1 };
      return { serverNow: fixture.now, record: fixture.record, created, isFirstEver: true };
    },
    getNight: async nightId => { fixture.calls.push("getNight:" + nightId); return { serverNow: fixture.now, record: fixture.record && fixture.record.nightId === nightId ? fixture.record : null }; },
    setPrefs: async patch => { fixture.calls.push("setPrefs"); fixture.prefs = { ...fixture.prefs, ...patch }; return { serverNow: fixture.now, prefs: { ...fixture.prefs } }; },
    getArchive: async cursor => {
      const rows = (fixture.records || (fixture.record ? [fixture.record] : [])).filter(row => !cursor || row.nightId < cursor).sort((a,b) => b.nightId.localeCompare(a.nightId));
      const items = rows.slice(0,30);
      return { serverNow: fixture.now, items, nextCursor: rows.length > 30 ? items[29].nightId : null };
    },
    track: async events => { fixture.calls.push("track:" + events.map(row => row.name).join(",")); return { serverNow: fixture.now, acceptedIds: events.map(row => row.eventId), duplicateIds: [] }; }
  };
  Object.assign(store.api, api);
  fixture.originalApi = originalApi;
  return page.controller.show().then(() => ({ ready: page.data.ready, canPress: page.data.canPress, width: wx.getWindowInfo().windowWidth }));
}
