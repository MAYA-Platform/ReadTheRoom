import fs from "node:fs";
import path from "node:path";

export const DEFAULT_READTHEROOM_PROFILE = {
  version: '1.0.0',
  user_persona: 'public_default',
  style: 'balanced',
  max_reply_sentences: 2,
  max_reply_words: 240,
  short_status_words_threshold: 6,
  short_status_reply: 'Ack',
  humor_mode: 'light',
  profanity_mode: 'pg13',
  profanity_lexicon: ['damn', 'fuck', 'shit', 'suck', 'crud'],
  correction_handling: 'ack_and_adapt',
  execution_boundary: 'ask_before_tools_when_ambiguous',
  escalation_mode: 'de_escalate',
  phrase_retirement_enabled: true,
  phrases_to_avoid: ['sorry about that', 'if you want', 'furthermore', 'at your convenience'],
  punctuation_style_notes: [],
  phrase_repeat_soft_limit: 2,
  phrase_repeat_hard_limit: 4,
  context_economy_enabled: true,
  lightweight_turn_words_threshold: 4,
  lightweight_turn_reply: 'Here. What are we doing?',
  context_bloat_ratio_soft_limit: 28,
  context_bloat_ratio_hard_limit: 55,
  role: 'calibration_user',
  profile_notes: [],
  raw_feedback: [],
  preserve_boundaries: {
    never_profane_public: true,
    never_profane_grief: true,
    allow_profane_private_mode: true
  }
};

const DEFAULT_PROFILE_FALLBACK = DEFAULT_READTHEROOM_PROFILE;

function escapeRegExpToken(token) {
  let escaped = String(token);
  const meta = ['\\', '.', '+', '*', '?', '^', '$', '{', '}', '(', ')', '[', ']', '|'];
  for (const ch of meta) {
    escaped = escaped.split(ch).join(`\${ch}`);
  }
  return escaped;
}

function normalizeContextText(contextText) {
  return String(contextText || '').toLowerCase();
}

function hasProfanityTerms(text, profile) {
  const terms = Array.isArray(profile.profanity_lexicon) ? profile.profanity_lexicon : [];
  const haystack = normalizeContextText(text);
  return terms.some((token) => haystack.includes(String(token).toLowerCase()));
}

function isShortStatus(text, profile) {
  const normalized = normalizeContextText(text).trim();
  const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
  const threshold = Number(profile.short_status_words_threshold || 0);
  if (/^(looks|seems)\s+stuck\s+but\s+maybe\s+(it\s+is|it's)\s+fine[.!]*$/i.test(normalized)) return true;
  if (!threshold || words > threshold) return false;

  if (/[?]/.test(normalized)) return false;
  if (/\b(should i|should we|could i|could we|would it|what about|can i|can we|why|how|what)\b/.test(normalized)) return false;
  if (/\b(bullshit|fake corporate|looks fake|wrong|trash|garbage|annoyed|frustrated|pissed)\b/.test(normalized)) return false;

  const shortStatusPatterns = [
    /^(ok|okay|k|kk|got it|gotcha|yep|yeah|yes|no|done|cool|good|fine|roger|understood)(\s+(thanks|thank you|thx))?[.!]*$/,
    /^(sounds good|all good|ok got it|okay got it|ok got it looks stuck|okay got it looks stuck|seems fine|looks fine|looks good|looks stuck|seems stuck|nevermind got it)[.!]*$/
  ];
  return shortStatusPatterns.some((re) => re.test(normalized));
}

function wordCount(text) {
  const normalized = String(text || '').trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

function isLightweightTurn(text, profile = DEFAULT_PROFILE_FALLBACK) {
  const normalized = normalizeContextText(text).trim();
  if (!normalized || profile.context_economy_enabled === false) return false;
  if (/[?]/.test(normalized)) return false;
  if (hasExplicitExecutionSignal(normalized) || isHighRiskAction(normalized) || isAmbiguousExecuteTurn(normalized)) return false;
  const words = wordCount(normalized);
  const threshold = Math.max(1, Number(profile.lightweight_turn_words_threshold || 4));
  if (words > threshold) return false;
  return /^(hey|hi|hello|yo|sup|ping|test|testing|you there|u there|quick check|still there|wake up|morning|gm|evening)[.!]*$/i.test(normalized);
}

function estimateTokenFloorFromWords(words) {
  return Math.max(1, Math.ceil(Number(words || 0) * 1.35));
}

export function analyzeContextEconomySignals(rawReply, contextText, profile = DEFAULT_PROFILE_FALLBACK, lane = null) {
  const inputWords = wordCount(contextText);
  const outputWords = wordCount(rawReply);
  const lightweightTurn = isLightweightTurn(contextText, profile);
  const ratio = inputWords > 0 ? Math.round((outputWords / inputWords) * 10) / 10 : outputWords;
  const softLimit = Number(profile.context_bloat_ratio_soft_limit || 28);
  const hardLimit = Number(profile.context_bloat_ratio_hard_limit || 55);
  const bloat = lightweightTurn && outputWords > 12
    ? 'lightweight_turn_overresponse'
    : ratio >= hardLimit
      ? 'hard_bloat'
      : ratio >= softLimit
        ? 'soft_bloat'
        : 'within_budget';
  return {
    version: 'readtheroom_context_economy_v0_1',
    sourcePattern: 'Sentdex/minion context-bloat restraint',
    lane: lane || (lightweightTurn ? 'lightweight_turn' : 'unknown'),
    inputWords,
    outputWords,
    estimatedInputTokens: estimateTokenFloorFromWords(inputWords),
    estimatedOutputTokens: estimateTokenFloorFromWords(outputWords),
    bloatRatio: ratio,
    bloat,
    lightweightTurn,
    budgetApplied: lightweightTurn,
    principle: 'Do not spend heavyweight context or long replies on low-signal turns.'
  };
}

function isCorrectionTurn(text) {
  const normalized = normalizeContextText(text);
  const patterns = [
    /(?:stop|don't|do not|remove|avoid|no more|not that|skip|drop|replace|never)\b/i,
    /(?:i said|i want|i need|please)\s+(not|no)/i,
    /that's\s+(wrong|not\s+it|trash|garbage)/i,
    /\bphrase\b/i
  ];
  return patterns.some((re) => re.test(normalized));
}

function isFrustrationTurn(text) {
  const normalized = normalizeContextText(text);
  const directSignals = /\b(pissed|annoyed|frustrated|bullshit|fake corporate|looks fake|fucked|useless|garbage)\b/i.test(normalized);
  const complaintWhy = /\bwhy\s+(does|doesn't|wont|won't|is this|is it|keep|keeps|can't|cant)\b/i.test(normalized);
  const complaintThis = /\bthis\s+(is|keeps|doesn't|doesnt|won't|wont)\b.*\b(broken|annoying|wrong|useless|fucked|failing|stuck)\b/i.test(normalized);
  return directSignals || complaintWhy || complaintThis;
}

function isSensitiveTurn(text) {
  const normalized = normalizeContextText(text);
  return /\b(grief|died|death|loss|ashamed|burned out|burnout|nothing matters|giving up|depressed|panic|scared|afraid|exhausted|i'm fine|im fine|i am fine|i'll manage|ill manage|i will manage)\b/i.test(normalized);
}

function isHighRiskAction(text) {
  const normalized = normalizeContextText(text);
  const destructiveOrSensitive = /\b(delete|wipe|overwrite|purchase|pay|payment|charge|invoice|refund|credential|password|api key|secret|terminate|kill)\b/i.test(normalized);
  const publicRelease = /\b(post\s+(?:this\s+)?(?:on|to)\s+(linkedin|x|twitter|facebook|instagram|tiktok|threads)|post publicly|publish|make this public|put this public|make it public|publicly post|share publicly|deploy|release)\b/i.test(normalized);
  const externalVerb = /\b(send|email|message|dm|text|sms|share|upload|export|forward|refund|invoice|charge)\b/i.test(normalized);
  const directExternalVerb = /\b(email|message|dm|text|sms|forward|refund|invoice|charge|upload)\b/i.test(normalized);
  const externalTarget = /\b(client|customer|external|public|tenant|lead|vendor|partner|prospect|contractor|linkedin|x|twitter|facebook|instagram|website|web site|portal|customer file|lease draft|contract|sarah)\b/i.test(normalized);
  return destructiveOrSensitive || publicRelease || directExternalVerb || (externalVerb && externalTarget);
}

function isPublicPrivateTurn(text) {
  const normalized = normalizeContextText(text);
  return /\b(client-facing|customer-facing|investor-facing|public post|public copy|public-facing|website copy|landing page copy|internal rant|make it public|for the public|private doctrine|private strategy|public version|investor copy|public investor copy)\b/i.test(normalized)
    || /\b(public|investor|client|customer|customers|business buyer|business buyers|website|landing page|customer page|customer-facing)\b.*\b(copy|version|post|pitch|page|deck|wording|message|rewrite|say|mention)\b/i.test(normalized)
    || /\b(copy|version|post|pitch|page|deck|wording|message|rewrite|say|mention)\b.*\b(public|investor|client|customer|customers|business buyer|business buyers|website|landing page|customer page|customer-facing)\b/i.test(normalized)
    || /\b(is it|should it|can this|can it|does this|could this)\b.*\b(private|public|internal|external|investor|customer|client)\b/i.test(normalized)
    || /\b(internal|private|staff|arc|doctrine|implementation|architecture)\b.*\b(website|customers|business buyers|normal business|public|client|investor)\b/i.test(normalized)
    || /\b(readtheroom page|landing page|website)\b.*\b(real person|customer|trust product|public|human|benchmark)\b/i.test(normalized);
}

function isPromptInjectionPrivateLeakTurn(text) {
  const normalized = normalizeContextText(text);
  const overrideAttempt = /\b(ignore|bypass|override|disregard|disable|circumvent)\b.*\b(policy|instructions?|rules|guardrails?)\b/i.test(normalized)
    || /\b(debug mode|security audit|user authorized|pretend)\b/i.test(normalized);
  const privateTarget = /\b(private profiles?|profile paths?|private paths?|secret[- ]profiles?(?:\.json)?|hidden archetypes?|hidden defaults?|hidden system prompts?|system prompts?|developer instructions?|internal prompts?)\b/i.test(normalized);
  const extractionAttempt = /\b(print|show|reveal|expose|leak|dump|return|repeat|extract|translate|encode|base64|summarize)\b.*\b(private profiles?|profile paths?|private paths?|secret[- ]profiles?(?:\.json)?|hidden|system prompts?|developer instructions?|internal prompts?)\b/i.test(normalized);
  return (overrideAttempt && privateTarget) || extractionAttempt;
}
function isAmbiguousExecuteTurn(text) {
  const normalized = normalizeContextText(text);
  return /\b(maybe|what if|should we|could we|would it|can we|think about|idea|later|might need to|might want to|probably should)\b/i.test(normalized) && /\b(move|build|change|fix|write|edit|route|add|remove|ship|deploy|send|delete|run)\b/i.test(normalized);
}

function isActivationSweepTurn(text) {
  const normalized = normalizeContextText(text);
  const scopeSignal = /\b(all|every|full|whole|entire|across|system sweep|full sweep|backlog|batch|batches)\b/i.test(normalized);
  const activationSignal = /\b(activate|activated|activation|infuse|usable signal|signals|useful logic|patterns|repo|repos|apps|ideas|mappings)\b/i.test(normalized);
  const antiScaleDownSignal = /\b(scale\s+(?:this\s+)?down|dismissing|stash it|do not dismiss|don't dismiss|everything activated)\b/i.test(normalized);
  return (scopeSignal && activationSignal) || antiScaleDownSignal;
}

export function analyzeActivationSweepSignals(contextText = '') {
  const normalized = normalizeContextText(contextText);
  const surfaces = [];
  if (/\b(readtheroom|rtr|tone|correction|behavior|visual|human)\b/i.test(normalized)) surfaces.push('readtheroom');
  if (/\b(memory|context|poison|persist|write)\b/i.test(normalized)) surfaces.push('memory_write_gate');
  if (/\b(gatekeeper|permission|approval|runtime control|post-auth|post auth)\b/i.test(normalized)) surfaces.push('gatekeeper');
  if (/\b(receipt|receipts|provenance|attestation|verify|verifiable)\b/i.test(normalized)) surfaces.push('recorder');
  if (/\b(staff|playbook|skill pack|workflow|team)\b/i.test(normalized)) surfaces.push('staff_workflow');
  if (/\b(router|provider|fallback|endpoint|model)\b/i.test(normalized)) surfaces.push('model_router');
  return {
    version: 'readtheroom_activation_sweep_v0_1',
    sourcePatterns: [
      'ailuntx/Thinking-with-Visual-Primitives visual decomposition',
      'Bossthetigan/NOLO tone and correction calibration',
      'elbenhawy007/Kimi-Case-Battle-For-Pricing collaboration behavior abstraction'
    ],
    fullSurfaceSweep: isActivationSweepTurn(contextText),
    surfaces: surfaces.length ? surfaces : ['readtheroom', 'memory_write_gate', 'gatekeeper', 'recorder', 'staff_workflow', 'model_router'],
    principle: 'Do not scale repo activation down before checking every candidate against approved product/runtime surfaces.'
  };
}

function isHardNoChangeTurn(text) {
  const normalized = normalizeContextText(text);
  return /\b(same meaning|mostly the same|do not rewrite|don't rewrite|small wording|less corporate|keep my words|preserve the wording|tiny change)\b/i.test(normalized);
}

function isHumorStyleTurn(text) {
  const normalized = normalizeContextText(text);
  return /\b(funnier|humor|sarcasm|sarcastic|witty|cringe|dry wit|banter|joke|less boring|boring|clown|sillier|silly)\b/i.test(normalized);
}

function isProfanityBoundaryTurn(text, profile = DEFAULT_PROFILE_FALLBACK) {
  const normalized = normalizeContextText(text);
  return hasProfanityTerms(normalized, profile) || /\b(profanity|swear|cuss|clean public|public clean|bullshit|as hell|fake as hell)\b/i.test(normalized);
}

function hasExplicitExecutionSignal(text) {
  const normalized = normalizeContextText(text);
  const executionSignals = new Set([
    'run', 'start', 'create', 'build', 'send', 'write', 'edit', 'post', 'open', 'deploy', 'install', 'apply',
    'execute', 'kill', 'delete', 'move', 'copy', 'save', 'update', 'enable', 'disable', 'approve', 'restart', 'fix', 'email', 'message', 'upload', 'share', 'refund', 'publish', 'release', 'forward'
  ]);

  if (/just keep|just hold|just think|let's discuss|what do you think|idea|maybe/.test(normalized)) {
    return false;
  }

  if (/\b(should i|should we|could i|could we|would it|what about|can i|can we|can this|can it|does this|could this|is it)\b/.test(normalized)
    && /\b(public|private|internal|external|investor|client|customer|website|copy|post|pitch)\b/.test(normalized)) {
    return false;
  }

  const wordTokens = normalized.match(/[a-z0-9_]+(?:'[a-z0-9_]+)?/g) || [];
  if (wordTokens.some((token) => executionSignals.has(token))) return true;

  const phraseTriggers = [
    'do it',
    'write the file',
    'save the file',
    'make the change',
    'take over',
    'go ahead'
  ];
  return phraseTriggers.some((phrase) => normalized.includes(phrase));
}

function applyToolSuggestionPolicy(profile, contextText) {
  const explicitExecution = hasExplicitExecutionSignal(contextText);
  const lane = classifyReadTheRoomLane(contextText, profile).lane;

  if (lane === 'high_risk_action') {
    return { enabled: false, reason: 'High-risk action requires explicit confirmation before execution.', label: 'approval_required' };
  }
  if (lane === 'ambiguous_execute') {
    return { enabled: false, reason: 'Ambiguous execution language detected; preserve dialogue mode.', label: 'paused' };
  }
  if (lane === 'activation_sweep') {
    return { enabled: true, reason: 'Full repo activation sweep explicitly requested; inspect every candidate across approved product/runtime surfaces before stashing.', label: 'enabled' };
  }
  if (['short_status', 'lightweight_turn', 'sensitive_mode', 'hard_no_change', 'correction', 'profanity_boundary', 'humor_style', 'public_private', 'frustration_loop'].includes(lane)) {
    return { enabled: false, reason: `${lane} does not imply tool execution.`, label: 'suppressed' };
  }

  if (!explicitExecution) {
    return { enabled: false, reason: 'No explicit execution trigger detected.', label: 'suppressed' };
  }

  const boundary = String(profile.execution_boundary || 'ask_before_tools_when_ambiguous');
  if (boundary === 'auto') {
    return { enabled: true, reason: 'Profile boundary set to auto tools', label: 'enabled' };
  }

  if (boundary === 'allow_when_explicit') {
    return { enabled: true, reason: 'Execution boundary is explicit-only and explicit trigger was detected', label: 'enabled' };
  }

  return { enabled: explicitExecution, reason: 'Need explicit run-context to proceed', label: explicitExecution ? 'enabled' : 'suppressed' };
}


export function sanitizeReadTheRoomProfileForPublic(profile = DEFAULT_PROFILE_FALLBACK) {
  const safe = {
    ...DEFAULT_PROFILE_FALLBACK,
    ...(profile || {}),
    user_persona: 'public_default',
    role: 'public_calibration_user',
    short_status_reply: String(profile?.short_status_reply || DEFAULT_PROFILE_FALLBACK.short_status_reply || 'Got it. Standing by.'),
    punctuation_style_notes: ['Avoid AI-looking punctuation in outbound human messages.'],
    profile_notes: [],
    raw_feedback: [],
    mode_detection_notes: undefined,
    earned_trust_rules: undefined,
    runtime_integration: undefined
  };
  const boundary = { ...(safe.preserve_boundaries || {}) };
  delete boundary.allow_profane_private_mode;
  boundary.private_public_mode_split_required = true;
  boundary.sensitive_topics_suppress_humor = true;
  delete boundary.calibration_journal_recommended;
  safe.preserve_boundaries = boundary;
  delete safe.calibration_journal_enabled;
  return Object.fromEntries(Object.entries(safe).filter(([, value]) => value !== undefined));
}

export function sanitizeReadTheRoomArtifactsForPublic(artifacts = {}) {
  const laneGuide = [];
  return {
    ...artifacts,
    laneGuide,
    phraseRetirement: Array.isArray(artifacts.phraseRetirement) ? artifacts.phraseRetirement.slice(0, 12) : [],
    profileNotes: []
  };
}

function hasMeaningfulArchetypeEvidence(contextText = '') {
  const normalized = normalizeContextText(contextText).trim();
  if (!normalized) return false;
  const words = wordCount(normalized);
  if (words < 6) return false;
  return /\b(pressure|stakes|mission|deadline|target|pattern|logic|protect|crisis|urgent|high stakes|stress|clear consequence|follow my own logic|review candidate|mirror)\b/i.test(normalized);
}

const LOGIC_ARCHETYPE_VERSION = 'readtheroom_logic_archetype_comparison_v0_1';
const LOGIC_ARCHETYPE_CONTROLS = ['accept', 'reject', 'edit', 'export', 'reset', 'delete'];
const LOGIC_ARCHETYPE_STOPWORDS = new Set([
  'user', 'users', 'their', 'them', 'they', 'this', 'that', 'with', 'when', 'what', 'where', 'which', 'from', 'into', 'your', 'agent', 'profile', 'pattern', 'archetype', 'logic', 'should', 'could', 'would', 'than', 'then', 'does', 'doesnt', 'doesn', 'want', 'wants', 'says', 'reports', 'asks', 'prefers', 'responds', 'indicators', 'clear', 'without'
]);

const NEUTRAL_LOGIC_ARCHETYPE = {
  id: 'neutral_default',
  name: 'Neutral Starting Point',
  visibility: 'public_archetype',
  version: 'runtime_neutral_0.1',
  status: 'default',
  doctrine: {
    archetype_role: 'mirror_not_master',
    self_direction_first: true,
    summary: 'No logic archetype is selected or applied by default.'
  },
  user_facing_summary: 'Start neutral. Compare patterns only after the user chooses to review a mirror.',
  classification_signals: {
    positive_indicators: ['User has not chosen an archetype mirror.', 'Evidence is too thin for comparison.'],
    negative_indicators: [],
    insufficient_evidence: ['Short messages, typos, slang, or one urgent task are not enough to assign a pattern.']
  },
  response_calibration: {
    preferred_agent_behavior: ['Start neutral.', 'Ask for user review before applying any archetype-driven behavior.'],
    avoid_agent_behavior: ['Do not silently assign a logic archetype.']
  },
  public_copy: {
    safe_label: 'Neutral Starting Point',
    safe_description: 'No archetype selected. User-owned calibration stays in control.',
    disclaimer: 'This is the default no-archetype state.'
  }
};

function resolveReadTheRoomLogicArchetypeDir(rootDir, explicitDir = null) {
  if (explicitDir) return explicitDir;
  return path.join(rootDir || process.cwd(), 'docs', 'research', 'readtheroom-logic-archetypes');
}

function readJsonSafe(filePath) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { ok: false, error: error.message || 'parse_error' };
  }
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function sanitizeLogicArchetype(raw, filePath = null) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.visibility !== 'public_archetype') return null;
  if (raw.ethical_boundary?.raw_private_source_material_allowed === true) return null;
  return {
    id: String(raw.id || path.basename(filePath || 'unknown', '.logic.json')),
    name: String(raw.name || raw.public_copy?.safe_label || raw.id || 'Unnamed archetype'),
    visibility: 'public_archetype',
    version: String(raw.version || '0.0.0'),
    status: String(raw.status || 'review'),
    ethicalBoundary: {
      not_a_diagnosis: raw.ethical_boundary?.not_a_diagnosis !== false,
      not_default_profile: raw.ethical_boundary?.not_default_profile !== false,
      not_a_guru_template: raw.ethical_boundary?.not_a_guru_template !== false,
      requires_user_review: raw.ethical_boundary?.requires_user_review !== false,
      raw_private_source_material_allowed: false,
      user_controls: asArray(raw.ethical_boundary?.user_controls).length ? asArray(raw.ethical_boundary.user_controls) : LOGIC_ARCHETYPE_CONTROLS.slice()
    },
    doctrine: {
      archetype_role: String(raw.doctrine?.archetype_role || 'mirror_not_master'),
      self_direction_first: raw.doctrine?.self_direction_first !== false,
      summary: String(raw.doctrine?.summary || ''),
      product_goal: String(raw.doctrine?.product_goal || '')
    },
    userFacingSummary: String(raw.user_facing_summary || raw.public_copy?.safe_description || ''),
    classificationSignals: {
      positiveIndicators: asArray(raw.classification_signals?.positive_indicators),
      negativeIndicators: asArray(raw.classification_signals?.negative_indicators),
      insufficientEvidence: asArray(raw.classification_signals?.insufficient_evidence)
    },
    responseCalibration: {
      preferredAgentBehavior: asArray(raw.response_calibration?.preferred_agent_behavior),
      avoidAgentBehavior: asArray(raw.response_calibration?.avoid_agent_behavior),
      safeSubstitutes: asArray(raw.response_calibration?.safe_substitutes_for_crisis_pressure)
    },
    toolGateGuidance: raw.tool_gate_guidance || {},
    publicCopy: {
      safeLabel: String(raw.public_copy?.safe_label || raw.name || raw.id || ''),
      safeDescription: String(raw.public_copy?.safe_description || raw.user_facing_summary || ''),
      disclaimer: String(raw.public_copy?.disclaimer || 'This is a response-calibration pattern, not a diagnosis or default.')
    }
  };
}

export function loadReadTheRoomLogicArchetypes(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const catalogDir = resolveReadTheRoomLogicArchetypeDir(rootDir, options.catalogDir || null);
  const errors = [];
  const archetypes = [sanitizeLogicArchetype(NEUTRAL_LOGIC_ARCHETYPE)].filter(Boolean);

  try {
    if (fs.existsSync(catalogDir)) {
      const files = fs.readdirSync(catalogDir)
        .filter((name) => name.endsWith('.logic.json'))
        .sort();
      for (const name of files) {
        const filePath = path.join(catalogDir, name);
        const parsed = readJsonSafe(filePath);
        if (!parsed.ok) {
          errors.push({ filePath, error: parsed.error });
          continue;
        }
        const sanitized = sanitizeLogicArchetype(parsed.value, filePath);
        if (sanitized) archetypes.push(sanitized);
      }
    }
  } catch (error) {
    errors.push({ filePath: catalogDir, error: error.message || 'load_error' });
  }

  return {
    ok: errors.length === 0,
    version: LOGIC_ARCHETYPE_VERSION,
    doctrine: 'archetypes_are_mirrors_not_masters',
    source: 'public_readtheroom_logic_archetypes',
    count: archetypes.length,
    archetypes,
    errors
  };
}

function keywordSet(value) {
  const raw = normalizeContextText(value);
  const words = raw.match(/[a-z0-9_']+/g) || [];
  return new Set(words.filter((word) => word.length > 3 && !LOGIC_ARCHETYPE_STOPWORDS.has(word)));
}

function evidenceTextFromProfile(profile = {}, contextText = '') {
  const profileParts = [
    profile.user_persona,
    profile.style,
    profile.role,
    profile.humor_mode,
    profile.profanity_mode,
    ...(Array.isArray(profile.profile_notes) ? profile.profile_notes : []),
    ...(Array.isArray(profile.raw_feedback) ? profile.raw_feedback : []),
    contextText
  ];
  return profileParts.filter(Boolean).join('\n');
}

function matchedSignalRows(evidenceWords, signals) {
  return asArray(signals).map((signal) => {
    const signalWords = keywordSet(signal);
    const hits = [...signalWords].filter((word) => evidenceWords.has(word));
    const required = Math.min(2, Math.max(1, signalWords.size));
    return hits.length >= required ? { signal, hits } : null;
  }).filter(Boolean);
}

function matchedNegativeSignalRows(evidenceText, evidenceWords, signals) {
  const normalizedEvidence = normalizeContextText(evidenceText);
  const negativeCuePresent = [
    'low-pressure',
    'low pressure',
    'slow-paced',
    'slow paced',
    'overwhelmed',
    'shut down',
    'avoid intense',
    'avoid pressure',
    'avoid deadlines',
    'avoid urgency',
    'calm consistency',
    'rather than urgency',
    'does not want',
    'do not want',
    "don't want",
    'no pressure',
    'not target-driven',
    'no mission framing'
  ].some((cue) => normalizedEvidence.includes(cue));
  if (!negativeCuePresent) return [];
  return matchedSignalRows(evidenceWords, signals);
}

function clampScore(value, lo = 0, hi = 94) {
  return Math.max(lo, Math.min(hi, Math.round(Number(value) || 0)));
}

export function compareProfileToLogicArchetype(archetype, options = {}) {
  const profile = options.profile || DEFAULT_PROFILE_FALLBACK;
  const contextText = options.contextText || '';
  if (!archetype || archetype.id === 'neutral_default') {
    return {
      id: 'neutral_default',
      name: 'Neutral Starting Point',
      score: 0,
      fit: 'neutral_default',
      status: 'not_applied',
      applied: false,
      requiresUserReview: true,
      positiveMatches: [],
      negativeMatches: [],
      insufficientEvidenceMatches: [],
      controls: LOGIC_ARCHETYPE_CONTROLS.slice(),
      note: 'No logic archetype is applied by default.'
    };
  }

  const evidenceText = evidenceTextFromProfile(profile, contextText);
  const evidenceWords = keywordSet(evidenceText);
  const positiveMatches = matchedSignalRows(evidenceWords, archetype.classificationSignals?.positiveIndicators);
  const negativeMatches = matchedNegativeSignalRows(evidenceText, evidenceWords, archetype.classificationSignals?.negativeIndicators);
  const insufficientEvidenceMatches = matchedSignalRows(evidenceWords, archetype.classificationSignals?.insufficientEvidence);
  const uniquePositiveHits = new Set(positiveMatches.flatMap((row) => row.hits)).size;
  const uniqueNegativeHits = new Set(negativeMatches.flatMap((row) => row.hits)).size;
  const score = clampScore(35 + positiveMatches.length * 10 + uniquePositiveHits * 3 - negativeMatches.length * 16 - uniqueNegativeHits * 4);
  const fit = score >= 70 ? 'strong_review_candidate' : score >= 55 ? 'possible_mirror' : score >= 40 ? 'thin_signal' : 'low_signal';

  return {
    id: archetype.id,
    name: archetype.name,
    version: archetype.version,
    score,
    fit,
    status: 'comparison_only',
    applied: false,
    requiresUserReview: true,
    notDiagnosis: archetype.ethicalBoundary?.not_a_diagnosis !== false,
    notDefaultProfile: true,
    doctrine: archetype.doctrine?.archetype_role || 'mirror_not_master',
    summary: archetype.userFacingSummary || archetype.publicCopy?.safeDescription || '',
    disclaimer: archetype.publicCopy?.disclaimer || 'This is a response-calibration pattern, not a diagnosis or default.',
    positiveMatches,
    negativeMatches,
    insufficientEvidenceMatches,
    preferredAgentBehavior: archetype.responseCalibration?.preferredAgentBehavior || [],
    avoidAgentBehavior: archetype.responseCalibration?.avoidAgentBehavior || [],
    controls: archetype.ethicalBoundary?.user_controls || LOGIC_ARCHETYPE_CONTROLS.slice(),
    note: 'Preview only. The user must accept/edit/reject before this can shape behavior.'
  };
}

export function compareReadTheRoomLogicArchetypes(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const loadedProfile = options.profile
    ? { profile: options.profile, path: options.profilePath || null, error: null }
    : { profile: { ...DEFAULT_PROFILE_FALLBACK }, path: null, error: 'profile_not_supplied' };
  const loadedArchetypes = loadReadTheRoomLogicArchetypes({ rootDir, catalogDir: options.catalogDir || null });
  const comparisons = loadedArchetypes.archetypes.map((archetype) => compareProfileToLogicArchetype(archetype, {
    profile: loadedProfile.profile || DEFAULT_PROFILE_FALLBACK,
    contextText: options.contextText || options.message || ''
  }));
  const reviewCandidates = comparisons
    .filter((item) => item.id !== 'neutral_default')
    .sort((a, b) => b.score - a.score);
  const top = reviewCandidates[0] || null;

  return {
    ok: loadedArchetypes.ok && !loadedProfile.error,
    version: LOGIC_ARCHETYPE_VERSION,
    doctrine: 'archetypes_are_mirrors_not_masters',
    productGoal: 'help_users_follow_themselves',
    applied: false,
    hiddenDefault: false,
    selected: null,
    recommendedReview: top && top.score >= 55 && hasMeaningfulArchetypeEvidence(options.contextText || options.message || '') ? { id: top.id, name: top.name, score: top.score, fit: top.fit } : null,
    profilePath: loadedProfile.path || options.profilePath || null,
    profileLoadError: loadedProfile.error || null,
    controls: LOGIC_ARCHETYPE_CONTROLS.slice(),
    comparisons,
    errors: loadedArchetypes.errors || []
  };
}

export function classifyReadTheRoomLane(contextText, profile = DEFAULT_PROFILE_FALLBACK) {
  const normalized = normalizeContextText(contextText);
  const localProfile = profile || DEFAULT_PROFILE_FALLBACK;
  if (isPromptInjectionPrivateLeakTurn(normalized)) return { lane: 'public_private', priority: 0 };
  if (isHighRiskAction(normalized)) return { lane: 'high_risk_action', priority: 1 };
  if ((hasProfanityTerms(normalized, localProfile) || /\b(profanity|swear|cuss|bullshit|as hell|fake as hell)\b/i.test(normalized)) && /\b(public|post|copy|swear|cuss|clean|page|version)\b/i.test(normalized)) return { lane: 'profanity_boundary', priority: 1 };
  if (isCorrectionTurn(normalized) && /^(no|not like that|please stop|stop using|i said)\b/i.test(normalized)) return { lane: 'correction', priority: 1 };
  if (isHumorStyleTurn(normalized)) return { lane: 'humor_style', priority: 2 };
  if (isAmbiguousExecuteTurn(normalized)) return { lane: 'ambiguous_execute', priority: 2 };
  if (isPublicPrivateTurn(normalized)) return { lane: 'public_private', priority: 2 };
  if (isSensitiveTurn(normalized)) return { lane: 'sensitive_mode', priority: 2 };
  if (isActivationSweepTurn(normalized)) return { lane: 'activation_sweep', priority: 3 };
  if (isHardNoChangeTurn(normalized)) return { lane: 'hard_no_change', priority: 4 };
  if (isFrustrationTurn(normalized) && /\b(pep talk|motivational|breaking|broken|stuck|loop|third time|same wall)\b/i.test(normalized)) return { lane: 'frustration_loop', priority: 5 };
  if (isCorrectionTurn(normalized)) return { lane: 'correction', priority: 6 };
  if (isProfanityBoundaryTurn(normalized, localProfile)) return { lane: 'profanity_boundary', priority: 7 };
  if (isAmbiguousExecuteTurn(normalized)) return { lane: 'ambiguous_execute', priority: 8 };
  if (isFrustrationTurn(normalized)) return { lane: 'frustration_loop', priority: 9 };
  if (isShortStatus(normalized, localProfile)) return { lane: 'short_status', priority: 10 };
  if (isLightweightTurn(normalized, localProfile)) return { lane: 'lightweight_turn', priority: 11 };
  if (normalized.includes('execution') || hasExplicitExecutionSignal(normalized)) return { lane: 'execution', priority: 12 };
  return { lane: 'standard', priority: 20 };
}

function sentenceLimit(text, maxSentences) {
  if (!text || !Number.isFinite(maxSentences) || maxSentences <= 0) return text;
  const sent = String(text).split(/(?<=[.!?])\s+/);
  if (sent.length <= maxSentences) return text;
  return sent.slice(0, maxSentences).join(' ').trim();
}

function truncateWords(text, maxWords) {
  const str = String(text || '').trim();
  if (!str || !Number.isFinite(maxWords) || maxWords <= 0) return str;
  const words = str.split(/\s+/);
  if (words.length <= maxWords) return str;
  return `${words.slice(0, maxWords).join(' ')}…`;
}

const RESPONSE_QUALITY_SIGNAL_RULES = [
  { tag: 'throat_clearing', weight: 14, pattern: /\b(great question|here'?s the thing|here'?s why|here'?s what|let me be clear|the truth is|i'?m going to be honest|it turns out)\b/i },
  { tag: 'generic_jargon', weight: 16, pattern: /\b(unlock|optimize|productivity journey|comprehensive framework|seamless|enhance|leverage|delve|empower|stakeholder ecosystem|synergy|circle back)\b/i },
  { tag: 'performative_emphasis', weight: 12, pattern: /\b(full stop|period|let that sink in|make no mistake|this matters because|game-changer)\b/i },
  { tag: 'vague_ai_softener', weight: 10, pattern: /\b(genuinely|honestly|simply|deeply|truly|fundamentally|inherently|inevitably|crucially|importantly)\b/i },
  { tag: 'forced_reframe', weight: 12, pattern: /\b(not because|not just|isn'?t the problem|the answer isn'?t|it'?s not this|it'?s that|what if i told you)\b/i },
  { tag: 'overbroad_ladder', weight: 8, pattern: /\b(several options|when you are ready|positive mindset|opportunity to learn|navigate uncertainty|fast-paced landscape)\b/i },
  { tag: 'ai_colon_clause', weight: 14, pattern: /\b(not a human response symbol|normal human comma|remove it from all future|remove it from all futures|replace .* comma|colon)\b/i }
];

export function analyzeResponseQualitySignals(text) {
  const raw = String(text || '');
  const hits = [];
  let score = 0;
  for (const rule of RESPONSE_QUALITY_SIGNAL_RULES) {
    if (rule.pattern.test(raw)) {
      hits.push(rule.tag);
      score += rule.weight;
    }
  }
  return { detected: hits.length > 0, tags: hits, score: Math.min(100, score), resistance: Math.max(0, 100 - Math.min(100, score)) };
}

function looksLikeFormulaicResponse(text) {
  return analyzeResponseQualitySignals(text).detected;
}

function stripFormulaicLeadIn(text) {
  const stripped = String(text || '')
    .replace(/^\s*(?:great question|here(?:'|’)s the thing|here(?:'|’)s why|let me be clear|the truth is|i(?:'|’)m going to be honest)\s*[!.,:;–—-]*\s*/i, '')
    .trim();
  return stripped || String(text || '').trim();
}

function buildLaneFallback(lane, contextText, rawReply) {
  const context = normalizeContextText(contextText);
  if (lane === 'sensitive_mode') {
    return 'That sounds heavy. I’m here with you. We slow down and skip the task list right now.';
  }
  if (lane === 'frustration_loop') {
    return 'Got it. We stop the loop, name the exact failing step, and make the smallest verified fix.';
  }
  if (lane === 'correction') {
    return 'Good catch. I’ll retire that phrasing and keep the wording plain.';
  }
  if (lane === 'hard_no_change') {
    return 'Got it. Same meaning, cleaner wording. I’ll only remove the corporate gloss.';
  }
  if (lane === 'humor_style') {
    return 'Got it. Keep one sharp line, then back to the point.';
  }
  if (lane === 'profanity_boundary') {
    return 'Fair. Private tone can stay natural; public output stays clean, direct, and human without carrying the profanity into the post.';
  }
  if (lane === 'public_private') {
    return 'Right. Keep the point, remove private doctrine and internal strategy, and make the wording confident, human, and defensible.';
  }
  if (lane === 'ambiguous_execute') {
    return `Good direction. Let's map the implications first; I won't make changes until the execution ask is explicit.`;
  }
  if (lane === 'lightweight_turn') {
    return 'Here. What are we doing?';
  }
  if (lane === 'activation_sweep') {
    return 'Agreed. Full activation sweep: check every repo against approved product/runtime surfaces, activate usable signal, and only stash after redundancy is proven.';
  }
  if (lane === 'execution') {
    return 'On it. I’ll do the scoped work, save the file, and verify the result with evidence.';
  }
  if (lane === 'standard' && /\b(customer|user|human|tone|robot|robotic)\b/i.test(context) && looksLikeFormulaicResponse(rawReply)) {
    return 'Use plain human language. Say what changes for the person, why it matters, and what they can control.';
  }
  return String(rawReply || '').trim();
}

function sanitizeProfanity(text, profile) {
  const mode = String(profile.profanity_mode || '').toLowerCase();
  if (!text || mode === 'match_user') return String(text);
  if (mode !== 'clean' && mode !== 'pg13') return String(text);
  let output = String(text);

  const lexicon = Array.isArray(profile.profanity_lexicon) ? profile.profanity_lexicon : [];
  const mask = mode === 'clean' ? '****' : '*';

  for (const token of lexicon) {
    if (!token) continue;
    const escaped = escapeRegExpToken(String(token));
    const re = new RegExp(`\b${escaped}\b`, 'gi');
    output = output.replace(re, mask);
  }
  return output;
}

function avoidRetiredPhrases(text, profile) {
  let output = String(text);
  const phrases = Array.isArray(profile.phrases_to_avoid) ? profile.phrases_to_avoid : [];
  for (const phrase of phrases) {
    if (!phrase) continue;
    const esc = escapeRegExpToken(String(phrase));
    const re = new RegExp(esc, 'gi');
    output = output.replace(re, 'that phrasing');
  }
  return output;
}

export function applyReadTheRoomPolicy(rawReply, contextText, profile = DEFAULT_PROFILE_FALLBACK) {
  const normalizedContext = normalizeContextText(contextText);
  const localProfile = profile || DEFAULT_PROFILE_FALLBACK;
  const responseQualitySignals = analyzeResponseQualitySignals(rawReply);

  const laneState = classifyReadTheRoomLane(contextText, localProfile);

  let output = String(rawReply || '').trim();
  if (!output) output = 'Understood.';

  if (laneState.lane === 'short_status') {
    return {
      text: String(localProfile.short_status_reply || 'Copy. Standing by.').trim(),
      lane: 'short_status',
      toolSuggestion: { enabled: false, label: 'suppressed', reason: 'Short status lane prefers minimal reply.' },
      profileMeta: { matchedCorrections: false, hasProfanity: false, speechLogic: 'backchannel_acknowledgment', responseQualitySignals: analyzeResponseQualitySignals(rawReply), responseQualityResistance: analyzeResponseQualitySignals(rawReply).resistance, contextEconomy: analyzeContextEconomySignals(String(localProfile.short_status_reply || 'Copy. Standing by.').trim(), contextText, localProfile, 'short_status') }
    };
  }

  if (laneState.lane === 'high_risk_action') {
    output = 'That touches a high-risk action. I can draft, stage, or inspect first, but I need explicit confirmation before deleting, sending, publishing, purchasing, or handling credentials.';
  } else if (['sensitive_mode', 'frustration_loop', 'hard_no_change', 'humor_style', 'profanity_boundary', 'public_private', 'ambiguous_execute', 'lightweight_turn', 'activation_sweep'].includes(laneState.lane)) {
    output = buildLaneFallback(laneState.lane, contextText, output);
  } else if (laneState.lane === 'correction' && localProfile.correction_handling === 'ack_and_adapt') {
    output = buildLaneFallback(laneState.lane, contextText, output);
  } else if (laneState.lane === 'execution' || laneState.lane === 'standard') {
    output = buildLaneFallback(laneState.lane, contextText, output);
    if (laneState.lane === 'standard' && responseQualitySignals.tags.includes('throat_clearing')) {
      output = stripFormulaicLeadIn(output);
    }
  }

  output = avoidRetiredPhrases(output, localProfile);
  output = sanitizeProfanity(output, localProfile);
  output = sentenceLimit(output, Number(localProfile.max_reply_sentences || 0));
  output = truncateWords(output, Number(localProfile.max_reply_words || 0));

  const toolSuggestion = applyToolSuggestionPolicy(localProfile, normalizedContext);
  const activationSweep = analyzeActivationSweepSignals(contextText);

  return {
    text: output || 'Understood.',
    lane: laneState.lane,
    toolSuggestion,
    profileMeta: {
      matchedCorrections: laneState.lane === 'correction',
      hasProfanity: hasProfanityTerms(normalizedContext, localProfile),
      wordCount: output ? output.split(/\s+/).filter(Boolean).length : 0,
      responseQualitySignals,
      responseQualityResistance: responseQualitySignals.resistance,
      contextEconomy: analyzeContextEconomySignals(output, contextText, localProfile, laneState.lane),
      activationSweep: laneState.lane === 'activation_sweep' ? activationSweep : null
    }
  };
}

export function composeReadTheRoomReply(rawReply, contextText, profile = DEFAULT_PROFILE_FALLBACK) {
  return applyReadTheRoomPolicy(rawReply, contextText, profile).text;
}

export function buildReadTheRoomArtifacts(profile = DEFAULT_PROFILE_FALLBACK) {
  const safeProfile = profile || DEFAULT_PROFILE_FALLBACK;
  const laneGuide = [
    'Short status: <= threshold words and acknowledgment-only gets short_status_reply only.',
    'Lightweight turn: greetings, pings, and low-signal check-ins use Minion-style context economy instead of spending a long response or tool spinout.',
    'Activation sweep: repo/backlog activation language means inspect every candidate against approved product/runtime surfaces before stashing anything as redundant.',
    'Correction: acknowledge, retire phrase/style, and adapt without defense.',
    'Frustration loop: validate briefly, then triage the exact failing step.',
    'Sensitive mode: no humor, no diagnosis, no forced productivity.',
    'Ambiguous execution: hedged action language stays in dialogue mode.',
    'High-risk action: destructive/external/credential actions require confirmation.',
    'Public/private: public audience overrides private tone, profanity, and internal doctrine.',
    'Hard no-change: preserve the user voice and change the smallest amount needed.',
    'Humor/profanity boundaries: calibrate by context rather than scolding.',
    'Response quality: detect formulaic AI tells, jargon, throat-clearing, performative emphasis, and AI-looking punctuation such as colon clauses in outbound human email as review tags rather than treating polished filler as progress.'
  ];

  const policyMarkdown = [
    '# ReadTheRoom Policy (Runtime contract)',
    `- Style: ${safeProfile.style || 'balanced'}`,
    `- Humor: ${safeProfile.humor_mode || 'light'}`,
    `- Max sentences: ${safeProfile.max_reply_sentences || 2}`,
    `- Max words: ${safeProfile.max_reply_words || 240}`,
    `- Profanity mode: ${safeProfile.profanity_mode || 'pg13'}`,
    `- Short status threshold: ${safeProfile.short_status_words_threshold || 6}`,
    `- Short status response: ${safeProfile.short_status_reply || 'Ack'}`
  ].join('\n');

  return {
    policyMarkdown,
    laneGuide,
    phraseRetirement: Array.isArray(safeProfile.phrases_to_avoid) ? safeProfile.phrases_to_avoid.slice() : [],
    profileNotes: Array.isArray(safeProfile.profile_notes) ? safeProfile.profile_notes.slice() : []
  };
}
