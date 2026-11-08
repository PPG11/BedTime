// Inject only after night-simulator.js in the running simulator. Never bundle.
function installReminderSimulatorFixture() {
  const fixture = getApp().__nightFixture;
  const store = getCurrentPages().slice(-1)[0].controller.store;
  const oldGetState = store.api.getState;
  store.api.getState = async () => ({ ...await oldGetState(), reminderAvailable: true });
  const state = { enabled: true, templateId: 'simulator_template_only', reminder: null, lastAttemptNightId: null, mode: 'accept', saves: 0, subscriptions: 0 };
  getApp().__reminderFixture = state;
  const reply = () => ({ serverNow: fixture.now, userId: fixture.userId, enabled: state.enabled, templateId: state.enabled ? state.templateId : null, reminder: state.reminder, lastAttemptNightId: state.lastAttemptNightId });
  wx.requestSubscribeMessage = options => {
    state.subscriptions++;
    options.success({ [state.templateId]: state.mode === 'reject' ? 'reject' : 'accept' });
  };
  // All other business calls are already intercepted by the night fixture.
  // Fail closed here so this UI test can never call the real reminder service.
  wx.cloud.callFunction = async ({ name, data }) => {
    if (name !== 'bedtimeNight' || !['getReminder', 'scheduleReminder', 'cancelReminder'].includes(data.action)) throw new Error('Unexpected UI fixture cloud call');
    if (data.action === 'scheduleReminder') {
      state.saves++;
      if (state.mode === 'unknown') throw new Error('Simulated lost response');
      const [hour, minute] = data.time.split(':').map(Number);
      const dueAt = Date.UTC(Number(data.nightId.slice(0, 4)), Number(data.nightId.slice(4, 6)) - 1, Number(data.nightId.slice(6, 8)), (hour < 6 ? hour + 24 : hour) - 8, minute);
      state.reminder = { requestId: data.requestId, revision: data.revision + 1, nightId: data.nightId, time: data.time, dueAt, status: 'pending' };
    }
    if (data.action === 'cancelReminder') state.reminder = { ...state.reminder, revision: state.reminder.revision + 1, status: 'cancelled' };
    return { result: { code: 'OK', data: reply() } };
  };
  return { installed: true };
}
