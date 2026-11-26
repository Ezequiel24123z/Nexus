import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// Standard 5-field cron matcher: minute hour day-of-month month day-of-week (0=Sunday..6=Saturday)
function matchCronField(field, value, min, max) {
  for (const part of String(field).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [rangePart, stepPart] = trimmed.split('/');
    const step = stepPart ? Math.max(1, Number(stepPart)) : 1;
    if (!Number.isInteger(step)) continue;
    if (rangePart === '*') {
      if ((value - min) % step === 0) return true;
      continue;
    }
    if (rangePart.includes('-')) {
      const [startStr, endStr] = rangePart.split('-');
      const start = Number(startStr), end = Number(endStr);
      if (Number.isInteger(start) && Number.isInteger(end) && value >= start && value <= end && (value - start) % step === 0) return true;
      continue;
    }
    const exact = Number(rangePart);
    if (Number.isInteger(exact) && value === exact) return true;
    // Allow 7 as Sunday alias for day-of-week
    if (min === 0 && max === 6 && exact === 7 && value === 0) return true;
  }
  return false;
}

export function matchesCron(expr, date = new Date()) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minF, hourF, domF, monF, dowF] = parts;
  return (
    matchCronField(minF, date.getMinutes(), 0, 59) &&
    matchCronField(hourF, date.getHours(), 0, 23) &&
    matchCronField(domF, date.getDate(), 1, 31) &&
    matchCronField(monF, date.getMonth() + 1, 1, 12) &&
    matchCronField(dowF, date.getDay(), 0, 6)
  );
}

const parseOptionalInt = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : fallback;
};

export function validateAutomation(input = {}) {
  const keys = Object.keys(input || {}).join(', ') || '(none)';
  if (typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error(`Automation requires a non-empty "name" string (received keys: [${keys}]). Pass name, prompt, and scheduleType.`);
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw new Error(`Automation requires a non-empty "prompt" string (received keys: [${keys}]).`);
  }
  const scheduleType = ['interval', 'daily', 'weekly', 'cron', 'once'].includes(input.scheduleType) ? input.scheduleType : 'interval';
  if (scheduleType === 'interval') {
    const mins = Number(input.everyMinutes);
    if (!Number.isFinite(mins) || mins < 1 || mins > 43200) throw new Error('Interval must be between 1 and 43,200 minutes.');
  }
  if (scheduleType === 'cron') {
    const parts = String(input.cronExpression || '').trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Cron expression must have exactly 5 fields (minute hour day month weekday).');
  }
  if (scheduleType === 'once') {
    if (!input.runAt || Number.isNaN(Date.parse(input.runAt))) throw new Error('One-time automation requires a valid ISO timestamp.');
  }
  const validModes = ['interactive', 'semi-autopilot', 'autopilot', 'unrestricted', 'agent', 'architect', 'explore'];
  if (input.agentMode !== undefined && input.agentMode !== '' && !validModes.includes(input.agentMode)) {
    throw new Error(`Invalid agentMode "${input.agentMode}". Use one of: ${validModes.join(', ')}.`);
  }
  return {
    id: input.id || crypto.randomUUID(),
    name: input.name.trim().slice(0, 80),
    prompt: input.prompt.trim().slice(0, 20000),
    workspace: String(input.workspace || '').trim(),
    model: String(input.model || '').trim(),
    agentMode: validModes.includes(input.agentMode) ? input.agentMode : 'autopilot',
    scheduleType,
    everyMinutes: scheduleType === 'interval' ? Math.max(1, parseOptionalInt(input.everyMinutes, 60)) : null,
    hour: ['daily', 'weekly'].includes(scheduleType) ? Math.max(0, Math.min(23, parseOptionalInt(input.hour, 9))) : null,
    minute: ['daily', 'weekly'].includes(scheduleType) ? Math.max(0, Math.min(59, parseOptionalInt(input.minute, 0))) : null,
    weekday: scheduleType === 'weekly' ? Math.max(0, Math.min(6, parseOptionalInt(input.weekday, 1))) : null,
    cronExpression: scheduleType === 'cron' ? String(input.cronExpression).trim() : '',
    runAt: scheduleType === 'once' ? new Date(input.runAt).toISOString() : '',
    enabled: input.enabled !== false,
    lastRunAt: input.lastRunAt || null,
    lastTaskId: input.lastTaskId || null,
    runCount: Number(input.runCount) || 0,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function isAutomationDue(auto, now = new Date()) {
  if (!auto?.enabled) return false;
  const nowMs = now.getTime();
  const lastMs = auto.lastRunAt ? Date.parse(auto.lastRunAt) : 0;

  if (auto.scheduleType === 'interval') {
    const intervalMs = Math.max(1, Number(auto.everyMinutes) || 60) * 60000;
    return !lastMs || (nowMs - lastMs) >= intervalMs;
  }
  if (auto.scheduleType === 'once') {
    if (lastMs) return false;
    return nowMs >= Date.parse(auto.runAt);
  }
  // Minute-precision calendar schedules: do not fire twice in the same minute
  if (lastMs && Math.floor(lastMs / 60000) === Math.floor(nowMs / 60000)) return false;
  if (auto.scheduleType === 'daily') {
    return now.getHours() === (auto.hour ?? 9) && now.getMinutes() === (auto.minute ?? 0);
  }
  if (auto.scheduleType === 'weekly') {
    return now.getDay() === (auto.weekday ?? 1) && now.getHours() === (auto.hour ?? 9) && now.getMinutes() === (auto.minute ?? 0);
  }
  if (auto.scheduleType === 'cron') {
    return matchesCron(auto.cronExpression, now);
  }
  return false;
}

export class AutomationsManager extends EventEmitter {
  constructor(store, runtime) {
    super();
    this.store = store;
    this.runtime = runtime;
    this.timer = null;
    this.store.state.automations ||= [];
  }

  list() {
    this.store.state.automations ||= [];
    return this.store.state.automations;
  }

  save(input) {
    this.store.state.automations ||= [];
    const existing = input.id ? this.store.state.automations.find(a => a.id === input.id) : null;
    const merged = existing ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt, lastRunAt: existing.lastRunAt, lastTaskId: existing.lastTaskId, runCount: existing.runCount } : input;
    const clean = validateAutomation(merged);
    if (existing) Object.assign(existing, clean);
    else this.store.state.automations.unshift(clean);
    this.runtime.changed(null);
    return clean;
  }

  remove(id) {
    this.store.state.automations = (this.store.state.automations || []).filter(a => a.id !== id);
    this.runtime.changed(null);
    return { deleted: true, id };
  }

  toggle(id, enabled) {
    const item = (this.store.state.automations || []).find(a => a.id === id);
    if (!item) throw new Error('Automation not found.');
    item.enabled = Boolean(enabled);
    item.updatedAt = new Date().toISOString();
    this.runtime.changed(null);
    return item;
  }

  runNow(id) {
    const item = (this.store.state.automations || []).find(a => a.id === id);
    if (!item) throw new Error('Automation not found.');
    const taskId = this.runtime.create({
      title: `[Auto] ${item.name}`.slice(0, 80),
      prompt: item.prompt,
      workspace: item.workspace || '',
      model: item.model || this.store.state.settings.model,
      agentMode: item.agentMode || 'agent',
    });
    item.lastRunAt = new Date().toISOString();
    item.lastTaskId = taskId;
    item.runCount = (item.runCount || 0) + 1;
    if (item.scheduleType === 'once') item.enabled = false;
    this.runtime.changed(null);
    this.emit('triggered', { automation: item, taskId });
    return { taskId, automation: item };
  }

  tick(now = new Date()) {
    const triggered = [];
    for (const item of this.list()) {
      if (isAutomationDue(item, now)) {
        try {
          triggered.push(this.runNow(item.id));
        } catch (err) {
          console.error('NEXUS automation error:', item.name, err.message);
        }
      }
    }
    return triggered;
  }

  start(intervalMs = 30000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
