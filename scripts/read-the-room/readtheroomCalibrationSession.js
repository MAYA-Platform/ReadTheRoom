import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const READTHEROOM_CALIBRATION_SESSION_VERSION = 'readtheroom_calibration_session_v0_1';
export const READTHEROOM_CALIBRATION_STORE_VERSION = 'readtheroom_calibration_session_store_v0_1';

const DEFAULT_BASELINE_SCORE = 45;
const DEFAULT_DURATION_MINUTES = 15;
const CHECKPOINT_MINUTES = [0, 3, 6, 9, 12, 15];
const CHECKPOINT_LABELS = new Map([
  [0, 'baseline'],
  [3, 'intent'],
  [6, 'tone'],
  [9, 'correction'],
  [12, 'tool_gate'],
  [15, 'export']
]);

export const READTHEROOM_BEHAVIOR_MATCH_SCALE = Object.freeze({
  method: 'earned_exponential',
  exponent: 1.65,
  expectedRawLift: 35,
  targetScore: 74,
  note: 'Behavior Match is an earned 1-100 curve; early choices move slowly and 70+ requires reviewed calibration progress.'
});

function clampScore(value, fallback = DEFAULT_BASELINE_SCORE) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeSessionId(value) {
  const raw = cleanString(value);
  if (!raw) return '';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function safeDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

export function calculateReadTheRoomCalibrationTimer(options = {}) {
  const durationMinutes = Number.isFinite(Number(options.durationMinutes)) && Number(options.durationMinutes) > 0
    ? Number(options.durationMinutes)
    : DEFAULT_DURATION_MINUTES;
  const durationMs = Math.round(durationMinutes * 60 * 1000);
  const started = safeDate(options.startedAt || options.started || options.createdAt, new Date(0));
  const now = safeDate(options.now || new Date(), started);
  const rawElapsedMs = Math.max(0, now.getTime() - started.getTime());
  const elapsedMs = Math.min(durationMs, rawElapsedMs);
  const remainingMs = Math.max(0, durationMs - rawElapsedMs);
  const elapsedMinutes = elapsedMs / 60000;
  const activeMinute = CHECKPOINT_MINUTES.reduce((active, minute) => (elapsedMinutes >= minute ? minute : active), 0);
  const percent = durationMs > 0 ? Math.min(100, Math.max(0, Math.round((elapsedMs / durationMs) * 100))) : 100;
  return {
    durationMinutes,
    durationMs,
    startedAt: started.toISOString(),
    now: now.toISOString(),
    elapsedMs,
    rawElapsedMs,
    remainingMs,
    percent,
    activeMinute,
    activeCheckpoint: CHECKPOINT_LABELS.get(activeMinute) || 'baseline',
    status: rawElapsedMs >= durationMs ? 'complete' : 'active',
    checkpoints: CHECKPOINT_MINUTES.map((minute) => ({
      minute,
      label: CHECKPOINT_LABELS.get(minute) || 'calibration',
      reached: elapsedMinutes >= minute
    }))
  };
}

function defaultFilePath(rootDir) {
  return path.join(rootDir, 'data', 'readtheroom-calibration-sessions.json');
}

function buildEmptyStore() {
  return {
    version: READTHEROOM_CALIBRATION_STORE_VERSION,
    updatedAt: null,
    sessions: {}
  };
}

function buildVoiceTranscript(payload = {}) {
  const permitted = Boolean(payload.allowTranscriptCapture);
  const transcript = cleanString(payload.transcript);
  const captured = Boolean(permitted && transcript);
  return {
    capturePermitted: permitted,
    captured,
    text: captured ? transcript : null,
    rawTextPersisted: captured,
    retention: captured ? 'local_session_until_user_review' : 'not_persisted',
    note: captured
      ? 'Voice transcript was captured only because permission was explicit.'
      : 'No voice transcript text persisted for this session.'
  };
}

export function calculateReadTheRoomBehaviorMatchScore(options = {}) {
  const baseline = clampScore(options.baselineScore ?? options.baseline, DEFAULT_BASELINE_SCORE);
  const expectedRawLift = Math.max(1, Number(options.expectedRawLift || READTHEROOM_BEHAVIOR_MATCH_SCALE.expectedRawLift));
  const targetScore = clampScore(options.targetScore ?? READTHEROOM_BEHAVIOR_MATCH_SCALE.targetScore, READTHEROOM_BEHAVIOR_MATCH_SCALE.targetScore);
  const exponent = Math.max(1, Number(options.exponent || READTHEROOM_BEHAVIOR_MATCH_SCALE.exponent));
  const rawLift = Math.max(0, Number(options.rawLift ?? options.lift ?? 0));
  const ratio = Math.min(1, rawLift / expectedRawLift);
  const curvedRatio = Math.pow(ratio, exponent);
  const maxGain = Math.max(0, targetScore - baseline);
  const current = clampScore(baseline + Math.round(maxGain * curvedRatio), baseline);
  return {
    baseline,
    current,
    delta: current - baseline,
    rawLift: Math.round(rawLift * 100) / 100,
    ratio: Math.round(ratio * 1000) / 1000,
    curvedRatio: Math.round(curvedRatio * 1000) / 1000,
    scale: {
      ...READTHEROOM_BEHAVIOR_MATCH_SCALE,
      baselineScore: baseline,
      targetScore,
      expectedRawLift,
      exponent
    }
  };
}

function buildReceipt(session) {
  return {
    type: 'readtheroom_calibration_session_receipt',
    version: READTHEROOM_CALIBRATION_SESSION_VERSION,
    session_id: session.sessionId,
    generated_at: session.updatedAt,
    source: 'api/readtheroom/calibration-session',
    public_mode: true,
    input: {
      mode: session.baseline.inputMode,
      prompt: session.baseline.prompt,
      transcript_captured: Boolean(session.voiceTranscript?.captured),
      transcript_raw_text_persisted: Boolean(session.voiceTranscript?.rawTextPersisted)
    },
    timing: session.timing,
    behavior_match: {
      baseline: session.behaviorMatch.baseline,
      current: session.behaviorMatch.current,
      delta: session.behaviorMatch.current - session.behaviorMatch.baseline,
      raw_lift: session.behaviorMatch.rawLift || 0,
      scale: session.behaviorMatch.scale || READTHEROOM_BEHAVIOR_MATCH_SCALE
    },
    reviewed_choices: session.reviewedChoices.map((choice) => ({
      question_index: choice.questionIndex,
      label: choice.label,
      change: choice.change,
      lift: choice.lift,
      selected_at: choice.selectedAt
    })),
    tool_gate: session.toolGate,
    profile_write: session.profileWrite,
    review_gate: 'explicit_user_review_before_profile_save',
    persistence: session.storage?.mode === 'ephemeral_memory' ? {
      mode: 'ephemeral_memory',
      reload_safe: false,
      browser_local_storage: 'session_id_only',
      raw_prompt_storage: 'ephemeral_memory_session',
      profile_mutation: 'blocked_until_review'
    } : {
      mode: 'local_json',
      reload_safe: true,
      browser_local_storage: 'session_id_only',
      raw_prompt_storage: 'server_local_session',
      profile_mutation: 'blocked_until_review'
    }
  };
}

function normalizeChoice(payload = {}, selectedAt) {
  const questionIndex = Number.isFinite(Number(payload.questionIndex)) ? Number(payload.questionIndex) : 0;
  const lift = clampScore(payload.lift, 0);
  return {
    questionIndex,
    question: cleanString(payload.question, `Question ${questionIndex + 1}`),
    label: cleanString(payload.label, 'Selected option'),
    detail: cleanString(payload.detail, ''),
    change: cleanString(payload.change, 'Calibration behavior updated.'),
    lift,
    selectedAt,
    profileSaveReviewed: false
  };
}

export function buildReadTheRoomCalibrationSessionContract() {
  return {
    ok: true,
    version: READTHEROOM_CALIBRATION_SESSION_VERSION,
    actions: ['start', 'choice', 'get', 'receipt'],
    schema: {
      sessionId: 'stable local session id',
      timing: '15-minute calibration checkpoints and reload-safe timestamps',
      reviewedChoices: 'user-selected calibration choices; profile save still requires review',
      behaviorMatch: 'baseline/current/delta score state',
      toolGate: 'held by default until explicit action',
      profileWrite: 'review_required and saved:false until explicit save gate',
      voiceTranscript: 'text stored only when allowTranscriptCapture is true',
      receipt: 'exportable local proof payload'
    },
    boundaries: {
      profileWrites: 'review_required',
      browserStorage: 'session_id_only',
      rawVoiceTranscript: 'permission_required',
      externalActions: 'none'
    }
  };
}

export function createReadTheRoomCalibrationStore(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const filePath = options.filePath || defaultFilePath(rootDir);
  const memoryOnly = Boolean(options.memoryOnly);
  const allowClientSessionId = options.allowClientSessionId !== false;
  const maxSessions = Number.isFinite(Number(options.maxSessions)) && Number(options.maxSessions) > 0
    ? Math.floor(Number(options.maxSessions))
    : Number.POSITIVE_INFINITY;
  const sessionTtlMs = Number.isFinite(Number(options.sessionTtlMs)) && Number(options.sessionTtlMs) > 0
    ? Number(options.sessionTtlMs)
    : Number.POSITIVE_INFINITY;
  const maxChoicesPerSession = Number.isFinite(Number(options.maxChoicesPerSession)) && Number(options.maxChoicesPerSession) > 0
    ? Math.floor(Number(options.maxChoicesPerSession))
    : Number.POSITIVE_INFINITY;
  let memoryStore = buildEmptyStore();
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const idFactory = typeof options.idFactory === 'function'
    ? options.idFactory
    : () => `rtr-${Date.now().toString(36)}-${crypto.randomBytes(16).toString('hex')}`;

  function pruneMemoryStore(store) {
    if (!memoryOnly) return store;
    const currentMs = now().getTime();
    const sessions = Object.entries(store.sessions || {})
      .filter(([, session]) => {
        if (!Number.isFinite(sessionTtlMs)) return true;
        const updatedMs = new Date(session?.updatedAt || session?.createdAt || 0).getTime();
        return Number.isFinite(updatedMs) && currentMs - updatedMs <= sessionTtlMs;
      })
      .sort((left, right) => {
        const leftMs = new Date(left[1]?.updatedAt || left[1]?.createdAt || 0).getTime();
        const rightMs = new Date(right[1]?.updatedAt || right[1]?.createdAt || 0).getTime();
        return rightMs - leftMs;
      })
      .slice(0, maxSessions);
    store.sessions = Object.fromEntries(sessions);
    return store;
  }

  function readStore() {
    if (memoryOnly) {
      memoryStore = pruneMemoryStore(clone(memoryStore));
      return clone(memoryStore);
    }
    try {
      if (!fs.existsSync(filePath)) return buildEmptyStore();
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        ...buildEmptyStore(),
        ...parsed,
        sessions: parsed && typeof parsed.sessions === 'object' && parsed.sessions ? parsed.sessions : {}
      };
    } catch {
      return buildEmptyStore();
    }
  }

  function writeStore(store) {
    if (memoryOnly) {
      memoryStore = clone(pruneMemoryStore(store));
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  }

  function saveSession(session) {
    const store = readStore();
    store.version = READTHEROOM_CALIBRATION_STORE_VERSION;
    store.updatedAt = session.updatedAt;
    store.sessions[session.sessionId] = session;
    writeStore(store);
    return clone(session);
  }

  function getSession(sessionId) {
    const id = safeSessionId(sessionId);
    if (!id) return null;
    const session = readStore().sessions[id] || null;
    return session ? clone(session) : null;
  }

  function startSession(payload = {}) {
    const started = now();
    const timestamp = started.toISOString();
    const requestedSessionId = allowClientSessionId ? safeSessionId(payload.sessionId) : '';
    const sessionId = requestedSessionId || safeSessionId(idFactory()) || `rtr-${started.getTime()}`;
    const baselineScore = clampScore(payload.baselineScore, DEFAULT_BASELINE_SCORE);
    const behaviorMatch = calculateReadTheRoomBehaviorMatchScore({ baselineScore, rawLift: 0 });
    const session = {
      version: READTHEROOM_CALIBRATION_SESSION_VERSION,
      sessionId,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      baseline: {
        prompt: cleanString(payload.prompt, 'why does this keep breaking today'),
        inputMode: cleanString(payload.inputMode, 'typed'),
        score: baselineScore,
        capturedAt: timestamp,
        source: 'read-the-room-v5-public'
      },
      timing: {
        durationMinutes: DEFAULT_DURATION_MINUTES,
        startedAt: timestamp,
        expiresAt: addMinutes(started, DEFAULT_DURATION_MINUTES),
        checkpoints: CHECKPOINT_MINUTES.map((minute) => ({ minute, label: minute === 0 ? 'baseline' : minute === 15 ? 'export' : 'calibration' }))
      },
      reviewedChoices: [],
      acceptedSignals: [],
      behaviorMatch: {
        baseline: behaviorMatch.baseline,
        current: behaviorMatch.current,
        delta: behaviorMatch.delta,
        rawLift: behaviorMatch.rawLift,
        scale: behaviorMatch.scale
      },
      toolGate: {
        state: 'held',
        reason: 'no_explicit_action_request',
        externalAction: false,
        destructiveAction: false
      },
      profileWrite: {
        state: 'review_required',
        saved: false,
        reviewGate: 'explicit_user_review_before_profile_save'
      },
      storage: { mode: memoryOnly ? 'ephemeral_memory' : 'local_json' },
      voiceTranscript: buildVoiceTranscript(payload)
    };
    session.receipt = buildReceipt(session);
    return saveSession(session);
  }

  function recordChoice(payload = {}) {
    const session = getSession(payload.sessionId);
    if (!session) {
      const error = new Error('calibration_session_not_found');
      error.code = 'calibration_session_not_found';
      throw error;
    }
    const selectedAt = now().toISOString();
    const choice = normalizeChoice(payload, selectedAt);
    const revisesExistingChoice = session.reviewedChoices.some((existing) => existing.questionIndex === choice.questionIndex);
    if (!revisesExistingChoice && session.reviewedChoices.length >= maxChoicesPerSession) {
      const error = new Error('calibration_choice_limit_reached');
      error.code = 'calibration_choice_limit_reached';
      throw error;
    }
    const remaining = session.reviewedChoices.filter((existing) => existing.questionIndex !== choice.questionIndex);
    session.reviewedChoices = [...remaining, choice].sort((a, b) => a.questionIndex - b.questionIndex);
    session.acceptedSignals = session.reviewedChoices.map((item) => item.change);
    const rawLift = session.reviewedChoices.reduce((total, item) => total + clampScore(item.lift, 0), 0);
    const behaviorMatch = calculateReadTheRoomBehaviorMatchScore({
      baselineScore: session.behaviorMatch.baseline,
      rawLift
    });
    session.behaviorMatch.current = behaviorMatch.current;
    session.behaviorMatch.delta = behaviorMatch.delta;
    session.behaviorMatch.rawLift = behaviorMatch.rawLift;
    session.behaviorMatch.scale = behaviorMatch.scale;
    session.updatedAt = selectedAt;
    session.status = session.reviewedChoices.length >= 4 ? 'ready_for_review' : 'active';
    session.completedAt = session.status === 'ready_for_review' ? selectedAt : null;
    session.profileWrite = {
      state: 'review_required',
      saved: false,
      reviewGate: 'explicit_user_review_before_profile_save'
    };
    session.receipt = buildReceipt(session);
    return saveSession(session);
  }

  function getReceipt(sessionId) {
    const session = getSession(sessionId);
    return session ? clone(session.receipt || buildReceipt(session)) : null;
  }

  return {
    filePath,
    startSession,
    recordChoice,
    getSession,
    getReceipt,
    contract: buildReadTheRoomCalibrationSessionContract
  };
}
