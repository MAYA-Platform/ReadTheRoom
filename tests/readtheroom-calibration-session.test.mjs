import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createReadTheRoomCalibrationStore, calculateReadTheRoomCalibrationTimer, calculateReadTheRoomBehaviorMatchScore } from '../scripts/read-the-room/readtheroomCalibrationSession.js';

function withTempStore() {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'rtr-calibration-session-'));
  const store = createReadTheRoomCalibrationStore({
    rootDir,
    now: () => new Date('2026-07-09T23:30:00.000Z'),
    idFactory: () => 'rtr-test-session'
  });
  return { rootDir, store, cleanup: () => rmSync(rootDir, { recursive: true, force: true }) };
}

test('starts a backend-backed calibration session with review gates and reload-safe schema', () => {
  const { rootDir, store, cleanup } = withTempStore();
  try {
    const session = store.startSession({
      prompt: 'why does this keep breaking today',
      inputMode: 'typed'
    });

    assert.equal(session.version, 'readtheroom_calibration_session_v0_1');
    assert.equal(session.sessionId, 'rtr-test-session');
    assert.equal(session.status, 'active');
    assert.equal(session.baseline.prompt, 'why does this keep breaking today');
    assert.equal(session.behaviorMatch.baseline, 45);
    assert.equal(session.behaviorMatch.current, 45);
    assert.equal(session.toolGate.state, 'held');
    assert.equal(session.profileWrite.state, 'review_required');
    assert.equal(session.profileWrite.saved, false);
    assert.deepEqual(session.reviewedChoices, []);
    assert.equal(session.voiceTranscript.capturePermitted, false);
    assert.equal(session.voiceTranscript.rawTextPersisted, false);
    assert.equal(session.receipt.profile_write.saved, false);

    const reloaded = createReadTheRoomCalibrationStore({ rootDir }).getSession('rtr-test-session');
    assert.equal(reloaded.sessionId, 'rtr-test-session');
    assert.equal(reloaded.baseline.prompt, 'why does this keep breaking today');
  } finally {
    cleanup();
  }
});

test('default public session IDs include at least 128 bits of random entropy', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'rtr-calibration-entropy-'));
  try {
    const store = createReadTheRoomCalibrationStore({ rootDir, memoryOnly: true });
    const session = store.startSession({ prompt: 'entropy check', inputMode: 'typed' });
    assert.match(session.sessionId, /^rtr-[a-z0-9]+-[0-9a-f]{32}$/i);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
test('public stores ignore caller-supplied session IDs instead of allowing session overwrite', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'rtr-calibration-id-boundary-'));
  try {
    const store = createReadTheRoomCalibrationStore({
      rootDir,
      memoryOnly: true,
      allowClientSessionId: false,
      idFactory: () => 'rtr-server-generated-session'
    });
    const session = store.startSession({
      sessionId: 'rtr-victim-session',
      prompt: 'caller must not select the storage key',
      inputMode: 'typed'
    });

    assert.equal(session.sessionId, 'rtr-server-generated-session');
    assert.equal(store.getSession('rtr-victim-session'), null);
    assert.equal(store.getSession('rtr-server-generated-session').baseline.prompt, 'caller must not select the storage key');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('memory-only public stores bound session count and expire stale sessions', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'rtr-calibration-bounds-'));
  let currentMs = Date.parse('2026-07-18T06:00:00.000Z');
  let sequence = 0;
  try {
    const store = createReadTheRoomCalibrationStore({
      rootDir,
      memoryOnly: true,
      maxSessions: 2,
      sessionTtlMs: 1000,
      now: () => new Date(currentMs),
      idFactory: () => `rtr-bounded-${++sequence}`
    });
    const first = store.startSession({ prompt: 'first' });
    currentMs += 100;
    const second = store.startSession({ prompt: 'second' });
    currentMs += 100;
    const third = store.startSession({ prompt: 'third' });

    assert.equal(store.getSession(first.sessionId), null, 'oldest session should be evicted at the cap');
    assert.ok(store.getSession(second.sessionId));
    assert.ok(store.getSession(third.sessionId));

    currentMs += 1001;
    assert.equal(store.getSession(second.sessionId), null, 'stale session should expire');
    assert.equal(store.getSession(third.sessionId), null, 'stale session should expire');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('public stores cap distinct reviewed choices per session while allowing an existing choice to be revised', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'rtr-calibration-choice-cap-'));
  try {
    const store = createReadTheRoomCalibrationStore({
      rootDir,
      memoryOnly: true,
      maxChoicesPerSession: 2,
      idFactory: () => 'rtr-choice-cap-session'
    });
    const session = store.startSession({ prompt: 'bounded choices' });
    store.recordChoice({ sessionId: session.sessionId, questionIndex: 0, label: 'first', change: 'first', lift: 1 });
    store.recordChoice({ sessionId: session.sessionId, questionIndex: 1, label: 'second', change: 'second', lift: 1 });
    const revised = store.recordChoice({ sessionId: session.sessionId, questionIndex: 1, label: 'second revised', change: 'second revised', lift: 2 });
    assert.equal(revised.reviewedChoices.length, 2);
    assert.equal(revised.reviewedChoices[1].label, 'second revised');
    assert.throws(
      () => store.recordChoice({ sessionId: session.sessionId, questionIndex: 2, label: 'third', change: 'third', lift: 1 }),
      (error) => error?.code === 'calibration_choice_limit_reached'
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('memory-only public calibration sessions never write prompt data to disk', () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'rtr-calibration-memory-'));
  try {
    const store = createReadTheRoomCalibrationStore({
      rootDir,
      memoryOnly: true,
      now: () => new Date('2026-07-18T06:00:00.000Z'),
      idFactory: () => 'rtr-public-memory-session'
    });
    const session = store.startSession({ prompt: 'private prompt sentinel', inputMode: 'typed' });

    assert.equal(session.receipt.persistence.mode, 'ephemeral_memory');
    assert.equal(session.receipt.persistence.reload_safe, false);
    assert.equal(session.receipt.persistence.raw_prompt_storage, 'ephemeral_memory_session');
    assert.equal(store.getSession('rtr-public-memory-session').baseline.prompt, 'private prompt sentinel');
    assert.equal(existsSync(path.join(rootDir, 'data', 'readtheroom-calibration-sessions.json')), false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
test('persists reviewed choices locally and updates the exportable receipt without saving a profile', () => {
  const { store, cleanup } = withTempStore();
  try {
    store.startSession({ prompt: 'make this sound human but not fake', inputMode: 'typed' });
    const afterChoice = store.recordChoice({
      sessionId: 'rtr-test-session',
      questionIndex: 0,
      question: 'How should MAYA handle personality and humor?',
      label: 'Natural, not fake',
      detail: 'Human, concise, no corporate polish.',
      change: 'Response loses fake polish and keeps a real human edge.',
      lift: 8
    });

    assert.equal(afterChoice.reviewedChoices.length, 1);
    assert.equal(afterChoice.reviewedChoices[0].label, 'Natural, not fake');
    assert.equal(afterChoice.behaviorMatch.current, 48);
    assert.equal(afterChoice.behaviorMatch.rawLift, 8);
    assert.equal(afterChoice.behaviorMatch.scale.method, 'earned_exponential');
    assert.equal(afterChoice.receipt.behavior_match.baseline, 45);
    assert.equal(afterChoice.receipt.behavior_match.current, 48);
    assert.equal(afterChoice.receipt.behavior_match.scale.method, 'earned_exponential');
    assert.equal(afterChoice.receipt.profile_write.state, 'review_required');
    assert.equal(afterChoice.receipt.profile_write.saved, false);
    assert.equal(afterChoice.receipt.review_gate, 'explicit_user_review_before_profile_save');
  } finally {
    cleanup();
  }
});

test('Behavior Match uses an earned exponential 1-100 curve instead of instant-good jumps', () => {
  const firstChoice = calculateReadTheRoomBehaviorMatchScore({ baselineScore: 45, rawLift: 8 });
  const halfRun = calculateReadTheRoomBehaviorMatchScore({ baselineScore: 45, rawLift: 17 });
  const fullReviewedRun = calculateReadTheRoomBehaviorMatchScore({ baselineScore: 45, rawLift: 35 });

  assert.equal(firstChoice.scale.method, 'earned_exponential');
  assert.equal(firstChoice.current, 48);
  assert.equal(halfRun.current, 54);
  assert.equal(fullReviewedRun.current, 74);
  assert.ok(firstChoice.current < 70, 'one good choice should not present as a strong match');
  assert.ok(halfRun.current < 70, 'partial calibration should not cross the good-match band');
});

test('does not persist voice transcript text unless capture permission is explicit', () => {
  const { store, cleanup } = withTempStore();
  try {
    const blocked = store.startSession({
      prompt: 'voice fallback prompt',
      inputMode: 'voice',
      transcript: 'raw microphone words should not persist by default',
      allowTranscriptCapture: false
    });
    assert.equal(blocked.voiceTranscript.capturePermitted, false);
    assert.equal(blocked.voiceTranscript.captured, false);
    assert.equal(blocked.voiceTranscript.text, null);
    assert.equal(blocked.voiceTranscript.rawTextPersisted, false);

    const allowed = store.startSession({
      sessionId: 'rtr-voice-allowed',
      prompt: 'voice capture allowed',
      inputMode: 'voice',
      transcript: 'capture this transcript with permission',
      allowTranscriptCapture: true
    });
    assert.equal(allowed.voiceTranscript.capturePermitted, true);
    assert.equal(allowed.voiceTranscript.captured, true);
    assert.equal(allowed.voiceTranscript.text, 'capture this transcript with permission');
    assert.equal(allowed.voiceTranscript.rawTextPersisted, true);
  } finally {
    cleanup();
  }
});

test('calculates real 15-minute timer checkpoints without wall-clock guessing', () => {
  const startedAt = '2026-07-09T23:30:00.000Z';
  const cases = [
    [0, 0, 0, 'baseline', 'active'],
    [180000, 20, 3, 'intent', 'active'],
    [360000, 40, 6, 'tone', 'active'],
    [540000, 60, 9, 'correction', 'active'],
    [720000, 80, 12, 'tool_gate', 'active'],
    [900000, 100, 15, 'export', 'complete'],
    [960000, 100, 15, 'export', 'complete']
  ];

  for (const [elapsedMs, percent, activeMinute, checkpoint, status] of cases) {
    const state = calculateReadTheRoomCalibrationTimer({ startedAt, now: new Date(new Date(startedAt).getTime() + elapsedMs).toISOString() });
    assert.equal(state.durationMs, 15 * 60 * 1000);
    assert.equal(state.percent, percent);
    assert.equal(state.activeMinute, activeMinute);
    assert.equal(state.activeCheckpoint, checkpoint);
    assert.equal(state.status, status);
    assert.equal(state.remainingMs, Math.max(0, 15 * 60 * 1000 - elapsedMs));
  }
});
