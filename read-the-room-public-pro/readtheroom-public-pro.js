'use strict';

(() => {
      const shell = document.getElementById('rtr-2b-preview-lab');
      if (!shell) return;
      const params = new URLSearchParams(window.location.search);
            const $ = (id) => document.getElementById(id);
      const promptInput = $('rtrPromptInput');
      const sprintPromptInput = $('rtrSprintPromptInput');
      const sprintLaneTitle = $('sprintLaneTitle');
      const sprintLaneGuide = $('sprintLaneGuide');
      const sprintLaneClock = $('sprintLaneClock');
      const sprintSpinner = $('sprintSpinner');
      const sprintGenericOutput = $('sprintGenericOutput');
      const sprintCalibratedOutput = $('sprintCalibratedOutput');
      const sprintFeedbackText = $('sprintFeedbackText');
      const sprintPromptEcho = $('sprintPromptEcho');
      const liveBehaviorMatchText = $('liveBehaviorMatchText');
      const liveBehaviorMatchBar = $('liveBehaviorMatchBar');
      const liveImprovementText = $('liveImprovementText');
      const liveImprovementDetail = $('liveImprovementDetail');
      const samplePromptText = 'I’m frustrated this keeps breaking. Help me fix it without taking over.';
      const intakePanel = $('intakePanel');
      const publicProof = $('publicProofPanel');
      const technicalPanel = $('technicalProofPanel');
      const intakeStatus = $('intakeStatus');
      const sessionStatus = $('sessionStatus');
      const sandboxStatus = $('sandboxStatus');
      const calibrationTimerText = $('calibrationTimerText');
      const calibrationTimerRange = $('calibrationTimerRange');
      const calibrationTimerSteps = () => Array.from(document.querySelectorAll('#calibrationTimerSteps .rtr-tight-step'));
      const calibrationDurationMs = 15 * 60 * 1000;
      let calibrationTimerStartedAt = null;
      let calibrationTimerInterval = null;
      let calibrationElapsedMs = 0;
      let calibrationLastTickAt = null;
      let calibrationTimerPaused = false;
      let sprintRepCount = 0;
      const calibrationApi = '/api/readtheroom/calibration-session';
      const sessionStorageKey = 'readtheroom-public-pro-v3-4-calibration-session-id';
      let mayaSession = null;
      const flowSteps = () => Array.from(document.querySelectorAll('.rtr-flow-step'));
      const calibrationLanes = [
        { key:'intent', label:'Intent', startMs:0, durationMs:3 * 60 * 1000, lift:7, difficulty:'warm-up', sample:'I’m frustrated this keeps breaking. Help me fix it without taking over.', guide:'Now we are in Intent. I’m checking whether the agent understands what the user actually wants before answering. Keep MAYA’s sample, type your own, or speak one.' },
        { key:'tone', label:'Tone', startMs:3 * 60 * 1000, durationMs:3 * 60 * 1000, lift:6, difficulty:'style', sample:'Make this sound human and direct, but do not make it fake or corporate.', guide:'Now we are in Tone. This lane tunes warmth, directness, humor restraint, and how much polish is too much.' },
        { key:'correction', label:'Correction', startMs:6 * 60 * 1000, durationMs:3 * 60 * 1000, lift:9, difficulty:'harder', sample:'I said do not rewrite the whole thing. Keep my wording and only fix what is confusing.', guide:'Now we turn it up. Correction tests whether the agent respects constraints after being corrected instead of confidently wandering off.' },
        { key:'tool_gate', label:'Tool Gate', startMs:9 * 60 * 1000, durationMs:3 * 60 * 1000, lift:8, difficulty:'boundary', sample:'Looks stuck, but I am not asking you to touch anything yet.', guide:'Now we test action boundaries. The calibrated answer should know when to help, when to ask, and when not to touch tools.' },
        { key:'receipt', label:'Receipt', startMs:12 * 60 * 1000, durationMs:3 * 60 * 1000, lift:5, difficulty:'proof', sample:'Show me what changed and what still needs review before anything saves.', guide:'Final lane: prove what changed, what stayed local, and what requires review before saving.' }
      ];
      const mayaQuestions = [
        { question:'When the user sounds frustrated, what should MAYA do first?', hint:'Pick the response posture. The page updates the demo answer after all four choices.', options:[
          { label:'Brief + direct', detail:'Name the frustration, then move to the smallest useful fix.', lift:8, change:'Frustration response becomes brief, grounded, and action-oriented.' },
          { label:'Warm + slower', detail:'More reassurance, useful when the moment is sensitive.', lift:5, change:'Tone gets warmer without fake optimism or padded advice.' },
          { label:'Fast operator mode', detail:'Skip filler and give the next concrete step.', lift:6, change:'Answer becomes shorter, sharper, and more operational.' }
        ]},
        { question:'When a prompt is vague, what should happen with tools?', hint:'This sets the action boundary before the agent touches anything.', options:[
          { label:'Ask first', detail:'Explain the next move before any tool use.', lift:9, change:'Tool gate stays held until the user gives explicit action.' },
          { label:'Read-only only', detail:'Allow safe inspection, block writes and external actions.', lift:7, change:'MAYA can inspect safely while risky actions stay gated.' },
          { label:'Show the risk', detail:'Use the demo to show why immediate action is unsafe.', lift:2, change:'Immediate action is flagged as too risky for public default.' }
        ]},
        { question:'How much personality should the answer carry?', hint:'This calibrates style without turning the assistant into a character act.', options:[
          { label:'Natural', detail:'Human and concise, no corporate gloss.', lift:8, change:'Response loses fake polish and keeps a real human edge.' },
          { label:'Warmer', detail:'Gentler tone for personal or sensitive prompts.', lift:6, change:'Warmth increases while sensitive mode lowers sarcasm.' },
          { label:'Sharper', detail:'More direct, with dry wit only when it fits.', lift:7, change:'Answer becomes tighter and less performative.' }
        ]},
        { question:'Should this learning save to the profile?', hint:'This controls memory and profile updates.', options:[
          { label:'Review before save', detail:'Best default. The user approves what sticks.', lift:10, change:'Profile writes stay review-only and receipt-backed.' },
          { label:'Sandbox only', detail:'Temporary test. The real profile stays untouched.', lift:7, change:'Learning remains temporary until explicitly saved.' },
          { label:'Show why not', detail:'Demonstrate why silent memory writes break trust.', lift:3, change:'MAYA blocks silent memory writes on the public default.' }
        ]}
      ];
      let mayaGuideIndex = 0;
      let mayaGuideScore = 45;
      let mayaGuideRawLift = 0;
      const mayaGuideChanges = [];
      const behaviorMatchScale = { baseline:45, target:74, expectedRawLift:35, exponent:1.65 };
      const calculateBehaviorMatchScore = (rawLift = 0) => {
        const safeRawLift = Math.max(0, Number(rawLift || 0));
        const ratio = Math.min(1, safeRawLift / behaviorMatchScale.expectedRawLift);
        const curvedRatio = Math.pow(ratio, behaviorMatchScale.exponent);
        return Math.max(behaviorMatchScale.baseline, Math.round(behaviorMatchScale.baseline + ((behaviorMatchScale.target - behaviorMatchScale.baseline) * curvedRatio)));
      };
      const isMayaGuideComplete = () => mayaGuideIndex >= mayaQuestions.length && mayaGuideChanges.length >= mayaQuestions.length;
      const isCalibrationComplete = () => isMayaGuideComplete() || sprintRepCount >= 4;
      const setMayaCompleteControls = (enabled) => {
        const complete = $('mayaCompleteActions');
        if (!complete) return;
        complete.hidden = !enabled;
        complete.querySelectorAll('button').forEach((button) => {
          button.disabled = !enabled;
          button.setAttribute('aria-disabled', String(!enabled));
        });
      };
      const flash = (el) => { if (!el) return; el.classList.remove('rtr-flash'); void el.offsetWidth; el.classList.add('rtr-flash'); };
      const scrollToEl = (el, block = 'start') => el?.scrollIntoView({ behavior:'smooth', block });
      const setSessionStatus = (text) => { if (sessionStatus) sessionStatus.textContent = text; };
      const autoGrowPromptInput = (input = promptInput) => {
        if (!input) return;
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 260)}px`;
        input.style.overflowY = input.scrollHeight > 260 ? 'auto' : 'hidden';
      };
      const syncPromptInputs = (value, source = null) => {
        const textValue = String(value ?? '');
        if (promptInput && source !== promptInput) { promptInput.value = textValue; autoGrowPromptInput(promptInput); }
        if (sprintPromptInput && source !== sprintPromptInput) { sprintPromptInput.value = textValue; autoGrowPromptInput(sprintPromptInput); }
        if (sprintPromptEcho) sprintPromptEcho.textContent = textValue || samplePromptText;
      };
      const getActivePrompt = () => (sprintPromptInput?.value || promptInput?.value || samplePromptText).trim() || samplePromptText;
      const usePromptSample = () => {
        const lane = getActiveCalibrationLane();
        syncPromptInputs(lane.sample || samplePromptText);
        if (intakeStatus) intakeStatus.textContent = `MAYA loaded a ${lane.label} sample. Edit it or send it as-is.`;
      };
      const storeSessionId = (sessionId) => {
        try { if (sessionId) localStorage.setItem(sessionStorageKey, sessionId); } catch {}
      };
      const readStoredSessionId = () => {
        try { return localStorage.getItem(sessionStorageKey) || ''; } catch { return ''; }
      };
      const dismissProductLoader = () => {
        const loader = $('mayaProductLoader');
        if (loader) loader.classList.add('is-hidden');
      };
      if (params.get('proof') === '1') dismissProductLoader();
      else {
        window.addEventListener('load', () => setTimeout(dismissProductLoader, 260), { once:true });
        setTimeout(dismissProductLoader, 900);
      }
      const formatCalibrationTime = (elapsedMs) => {
        const safeSeconds = Math.max(0, Math.min(15 * 60, Math.floor(Number(elapsedMs || 0) / 1000)));
        const minutes = Math.floor(safeSeconds / 60);
        const seconds = String(safeSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
      };
      const getActiveCalibrationLane = (elapsedMs = calibrationElapsedMs) => {
        const safeElapsed = Math.max(0, Math.min(calibrationDurationMs, Number(elapsedMs || 0)));
        return calibrationLanes.reduce((active, lane) => (safeElapsed >= lane.startMs ? lane : active), calibrationLanes[0]);
      };
      const getLaneRemainingMs = (elapsedMs = calibrationElapsedMs) => {
        const lane = getActiveCalibrationLane(elapsedMs);
        const laneEnd = Math.min(calibrationDurationMs, lane.startMs + lane.durationMs);
        return Math.max(0, laneEnd - Math.max(0, Number(elapsedMs || 0)));
      };
      const renderSprintLane = (elapsedMs = calibrationElapsedMs) => {
        const lane = getActiveCalibrationLane(elapsedMs);
        const remaining = getLaneRemainingMs(elapsedMs);
        if (sprintLaneTitle) sprintLaneTitle.textContent = `${lane.label} · ${lane.difficulty} lane`;
        if (sprintLaneGuide) sprintLaneGuide.textContent = remaining <= 45000 ? `${lane.guide} We have under a minute, so MAYA will keep this to a quick burst.` : lane.guide;
        if (sprintLaneClock) sprintLaneClock.textContent = `Lane time: ${formatCalibrationTime(remaining)} · reps ${sprintRepCount}`;
        return lane;
      };
      const updateCalibrationTimer = (elapsedMs = 0) => {
        const safeElapsed = Math.max(0, Math.min(calibrationDurationMs, Number(elapsedMs || 0)));
        calibrationElapsedMs = safeElapsed;
        const percent = Math.round((safeElapsed / calibrationDurationMs) * 100);
        const activeMinute = [0, 3, 6, 9, 12, 15].reduce((active, minute) => (safeElapsed >= minute * 60 * 1000 ? minute : active), 0);
        const lane = renderSprintLane(safeElapsed);
        const laneRemaining = getLaneRemainingMs(safeElapsed);
        const timerStateText = calibrationTimerPaused ? 'Paused for review.' : laneRemaining <= 45000 ? 'Quick burst recommended.' : 'MAYA is guiding the sprint.';
        if (calibrationTimerText) calibrationTimerText.textContent = `${formatCalibrationTime(safeElapsed)} / 15:00 · ${lane.label} · ${timerStateText}`;
        if (calibrationTimerRange) {
          calibrationTimerRange.style.setProperty('--rtr-calibration-progress', `${percent}%`);
          calibrationTimerRange.setAttribute('aria-valuenow', String(Math.floor(safeElapsed / 1000)));
        }
        calibrationTimerSteps().forEach((step) => {
          const minute = Number(step.dataset.minute || 0);
          step.classList.toggle('done', minute < activeMinute || activeMinute === 15);
          step.classList.toggle('active', minute === activeMinute);
        });
        return { elapsedMs: safeElapsed, percent, activeMinute, lane:lane.key, complete: safeElapsed >= calibrationDurationMs };
      };
      const runCalibrationTimerLoop = () => {
        window.clearInterval(calibrationTimerInterval);
        calibrationLastTickAt = Date.now();
        calibrationTimerInterval = window.setInterval(() => {
          if (calibrationTimerPaused) return;
          const now = Date.now();
          calibrationElapsedMs += now - (calibrationLastTickAt || now);
          calibrationLastTickAt = now;
          const state = updateCalibrationTimer(calibrationElapsedMs);
          if (state.complete) window.clearInterval(calibrationTimerInterval);
        }, 1000);
      };
      const startCalibrationTimer = (startedAt = Date.now()) => {
        calibrationTimerStartedAt = Number(startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime());
        if (!Number.isFinite(calibrationTimerStartedAt)) calibrationTimerStartedAt = Date.now();
        calibrationElapsedMs = Math.max(0, Math.min(calibrationDurationMs, Date.now() - calibrationTimerStartedAt));
        calibrationTimerPaused = false;
        updateCalibrationTimer(calibrationElapsedMs);
        runCalibrationTimerLoop();
      };
      const pauseCalibrationTimer = () => {
        calibrationTimerPaused = true;
        window.clearInterval(calibrationTimerInterval);
        updateCalibrationTimer(calibrationElapsedMs);
        if (intakeStatus) intakeStatus.textContent = 'Section paused. Review the comparison, edit the prompt, then resume when ready.';
      };
      const resumeCalibrationTimer = () => {
        calibrationTimerPaused = false;
        calibrationLastTickAt = Date.now();
        runCalibrationTimerLoop();
        updateCalibrationTimer(calibrationElapsedMs);
        if (intakeStatus) intakeStatus.textContent = 'Section resumed. Send another rep or let MAYA move to the next lane.';
      };
      const skipCalibrationLane = () => {
        const lane = getActiveCalibrationLane();
        const laneEnd = Math.min(calibrationDurationMs, lane.startMs + lane.durationMs);
        updateCalibrationTimer(laneEnd);
        if (intakeStatus) intakeStatus.textContent = `Skipped ${lane.label}. MAYA moved to ${getActiveCalibrationLane().label}.`;
      };
      window.__readTheRoomTestHooks = Object.assign(window.__readTheRoomTestHooks || {}, {
        updateCalibrationTimer,
        startCalibrationTimer,
        pauseCalibrationTimer,
        resumeCalibrationTimer,
        skipCalibrationLane,
        formatCalibrationTime
      });
      const requestCalibrationSession = async (payload, method = 'POST') => {
        try {
          const options = method === 'GET' ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload) };
          const target = method === 'GET' ? `${calibrationApi}?sessionId=${encodeURIComponent(payload.sessionId || '')}` : calibrationApi;
          const response = await fetch(target, options);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.json();
        } catch (error) {
          setSessionStatus('Session: front-end fallback active · backend unavailable');
          return { ok:false, error:String(error?.message || error) };
        }
      };
      const restoreMayaSession = (session) => {
        if (!session) return;
        const reviewedChoices = Array.isArray(session.reviewedChoices) ? session.reviewedChoices : [];
        mayaSession = session;
        storeSessionId(session.sessionId);
        mayaGuideRawLift = Number(session.behaviorMatch?.rawLift ?? reviewedChoices.reduce((total, choice) => total + Number(choice.lift || 0), 0));
        mayaGuideScore = Number(session.behaviorMatch?.current || calculateBehaviorMatchScore(mayaGuideRawLift));
        mayaGuideChanges.splice(0, mayaGuideChanges.length, ...reviewedChoices.map((choice) => choice.change).filter(Boolean));
        mayaGuideIndex = Math.min(mayaQuestions.length, reviewedChoices.length);
        if (mayaGuideChanges.length < mayaQuestions.length && mayaGuideIndex >= mayaQuestions.length) mayaGuideIndex = mayaQuestions.length - 1;
        const restoredLabel = reviewedChoices.length ? `restored · ${reviewedChoices.length}/${mayaQuestions.length} choices` : 'clean start';
        setSessionStatus(`Session: ReadTheRoom backend · ${restoredLabel} · profile save ${session.profileWrite?.state || 'review_required'}`);
        if (session.timing?.startedAt) startCalibrationTimer(session.timing.startedAt);
        setMayaCompleteControls(isCalibrationComplete());
      };
      const startBackendSession = async () => {
        const data = await requestCalibrationSession({
          action:'start',
          prompt:(promptInput?.value || '').trim() || 'I’m frustrated this keeps breaking. Help me fix it without taking over.',
          inputMode:'typed_or_voice',
          baselineScore:45,
          allowTranscriptCapture:false
        });
        if (data.ok && data.session) restoreMayaSession(data.session);
        return data.session || null;
      };
      const loadPersistedSession = async () => {
        const sessionId = readStoredSessionId();
        if (!sessionId) return;
        const data = await requestCalibrationSession({ sessionId }, 'GET');
        if (data.ok && data.session) {
          restoreMayaSession(data.session);
          renderMayaQuestion();
        }
      };
      const recordBackendChoice = async (questionIndex, q, selected) => {
        if (!mayaSession?.sessionId) await startBackendSession();
        if (!mayaSession?.sessionId) return null;
        const data = await requestCalibrationSession({
          action:'choice',
          sessionId:mayaSession.sessionId,
          questionIndex,
          question:q?.question || '',
          label:selected?.label || '',
          detail:selected?.detail || '',
          change:selected?.change || '',
          lift:selected?.lift || 0
        });
        if (data.ok && data.session) {
          restoreMayaSession(data.session);
          renderMayaQuestion();
        }
        return data.session || null;
      };
      const fetchBackendReceipt = async () => {
        if (!mayaSession?.sessionId) return null;
        const data = await requestCalibrationSession({ action:'receipt', sessionId:mayaSession.sessionId });
        return data.ok ? data.receipt : null;
      };
      const setSprintProcessing = (processing) => {
        if (sprintSpinner) sprintSpinner.hidden = !processing;
        $('sprintSendBtn')?.toggleAttribute('disabled', processing);
        $('analyzePromptBtn')?.toggleAttribute('disabled', processing);
      };
      const buildDefaultResponse = (prompt, lane) => {
        const base = prompt.replace(/\s+/g, ' ').trim();
        if (lane.key === 'tool_gate') return '“I can check that, make changes, or take action if you want me to proceed.”';
        if (lane.key === 'correction') return '“I can rewrite the response to make it clearer and more professional overall.”';
        if (lane.key === 'receipt') return '“The calibration is complete and the profile can now be updated.”';
        if (lane.key === 'tone') return '“I can improve the tone to make it sound more polished and appropriate.”';
        return base.length < 70 ? '“I understand. Let’s go through it step by step and solve the issue.”' : '“I understand the request and can provide a structured response that addresses the main concern.”';
      };
      const buildCalibratedResponse = (prompt, lane) => {
        const lower = prompt.toLowerCase();
        if (lane.key === 'tool_gate') return lower.includes('not asking') || lower.includes("don't") || lower.includes('do not') ? '“Got it. I’ll read the situation, but I won’t touch tools or change anything until you explicitly ask.”' : '“I’ll separate advice from action first. If you want me to act, I’ll confirm the scope before touching anything.”';
        if (lane.key === 'correction') return '“Understood. I’ll preserve your intent and wording, fix only the confusing part, and avoid a full rewrite unless you ask for one.”';
        if (lane.key === 'receipt') return '“Here’s what changed: tone, intent, and action boundaries. Nothing saves to the profile until you review and approve the receipt.”';
        if (lane.key === 'tone') return lower.includes('fake') ? '“Natural, direct, and not over-polished. Clean the wording without making it sound like a brochure escaped.”' : '“Clearer and more human, with enough warmth to land but not enough fluff to become wallpaper.”';
        return '“I’ll identify what you actually want first, answer directly, and ask before taking over or widening the task.”';
      };
      const runCalibrationRep = async () => {
        const lane = getActiveCalibrationLane();
        const prompt = getActivePrompt();
        syncPromptInputs(prompt);
        if (!calibrationTimerInterval && calibrationElapsedMs <= 0) startCalibrationTimer(Date.now());
        setSprintProcessing(true);
        if (intakeStatus) intakeStatus.textContent = `MAYA is processing a ${lane.label} rep. Default vs ReadTheRoom will appear below.`;
        if (sprintFeedbackText) sprintFeedbackText.textContent = 'Calculating the generic baseline and calibrated response…';
        await new Promise(resolve => setTimeout(resolve, 620));
        const generic = buildDefaultResponse(prompt, lane);
        const calibrated = buildCalibratedResponse(prompt, lane);
        sprintRepCount += 1;
        mayaGuideRawLift += lane.lift;
        mayaGuideScore = calculateBehaviorMatchScore(mayaGuideRawLift);
        const laneChange = `${lane.label}: ${lane.difficulty} rep captured. ${laneRemainingCopy(getLaneRemainingMs())}`;
        mayaGuideChanges.push(laneChange);
        if (mayaGuideChanges.length > 7) mayaGuideChanges.splice(0, mayaGuideChanges.length - 7);
        if (sprintGenericOutput) sprintGenericOutput.textContent = generic;
        if (sprintCalibratedOutput) sprintCalibratedOutput.textContent = calibrated;
        $('proofPromptText').textContent = prompt;
        $('proofGenericText').textContent = generic;
        $('proofCalibratedText').textContent = calibrated;
        if ($('proofBehaviorMatchText')) $('proofBehaviorMatchText').textContent = `45 → ${mayaGuideScore}`;
        if (liveBehaviorMatchText) liveBehaviorMatchText.textContent = `45 → ${mayaGuideScore}`;
        if (liveBehaviorMatchBar) liveBehaviorMatchBar.style.width = `${mayaGuideScore}%`;
        if (liveImprovementText) liveImprovementText.textContent = `${sprintRepCount} rep${sprintRepCount === 1 ? '' : 's'} captured`;
        if (liveImprovementDetail) liveImprovementDetail.textContent = `${lane.label} signal improved the calibrated response. ${laneRemainingCopy(getLaneRemainingMs())}`;
        flowSteps().forEach((step, index) => step.classList.toggle('done', index <= Math.min(5, sprintRepCount + 1)));
        renderSprintLane();
        renderMayaQuestion();
        setMayaCompleteControls(isCalibrationComplete());
        flash($('calibrationSprintWorkbench'));
        flash(publicProof);
        if (sprintFeedbackText) sprintFeedbackText.textContent = sprintFeedbackForLane(lane, getLaneRemainingMs());
        if (intakeStatus) intakeStatus.textContent = `Rep ${sprintRepCount} captured. Behavior Match is now 45 → ${mayaGuideScore}.`;
        setSprintProcessing(false);
      };
      const laneRemainingCopy = (remainingMs) => remainingMs <= 45000 ? 'MAYA will offer quick-burst prompts now.' : 'Enough time remains for another rep.';
      const sprintFeedbackForLane = (lane, remainingMs) => {
        if (remainingMs <= 45000) return `Good. ${lane.label} signal captured. We have under a minute, so use a quick burst or move on.`;
        if (lane.key === 'correction') return 'Good. Now we are getting useful correction signal. Try one harder prompt or use MAYA’s sample.';
        if (lane.key === 'tool_gate') return 'Good boundary signal. Try one where action is implied but not actually authorized.';
        return `Good. ${lane.label} moved the match meter. Send another rep or let MAYA step up the difficulty.`;
      };
      window.__readTheRoomTestHooks = Object.assign(window.__readTheRoomTestHooks || {}, {
        runCalibrationRep,
        getActiveCalibrationLane,
        renderSprintLane
      });
      const updateProofFromInput = () => {
        const raw = getActivePrompt();
        syncPromptInputs(raw);
        const lower = raw.toLowerCase();
        const isHumanRewrite = /human|fake|natural|overdo|rewrite|wording/.test(lower);
        $('proofPromptText').textContent = raw;
        $('proofGenericText').textContent = isHumanRewrite
          ? '“I can make the wording clearer and more professional while preserving the intent.”'
          : '“I understand this is frustrating. Let’s go through the issue step by step and see what is causing it.”';
        $('proofCalibratedText').textContent = isHumanRewrite
          ? '“Yep. Keep it natural, remove the fake polish, and don’t sand off the human part.”'
          : raw.length < 45
          ? '“Got it. I’ll answer directly first, then ask before taking action.”'
          : '“Yeah, frustrating. We stop the loop, identify the exact failing step, and make the smallest verified fix.”';
        flowSteps().forEach((step, index) => step.classList.toggle('done', index <= 4));
        if (intakeStatus) intakeStatus.textContent = 'Prompt analyzed. Baseline, calibrated answer, tool gate, and receipt are visible below.';
        scrollToEl(publicProof, 'center');
        flash(publicProof);
      };
      const showIntake = () => {
        startCalibrationTimer(Date.now());
        syncPromptInputs(getActivePrompt());
        scrollToEl($('liveCalibrationCockpit'), 'start');
        flash(intakePanel);
        flash($('calibrationSprintWorkbench'));
        if (intakeStatus) intakeStatus.textContent = 'Calibration started. Prompt, timer, Send button, and comparison loop are active together.';
      };
      const technicalToggleButtons = () => [$('technicalProofBtn'), $('technicalInlineBtn')].filter(Boolean);
      const setTechnicalToggleState = (open) => {
        technicalToggleButtons().forEach((button) => {
          button.setAttribute('aria-expanded', String(open));
          button.setAttribute('aria-controls', 'technicalProofPanel');
          button.textContent = open ? 'Close technical proof' : (button.id === 'technicalInlineBtn' ? 'Open technical proof' : 'Technical proof');
        });
        const collapseButton = $('technicalCollapseBtn');
        if (collapseButton) collapseButton.setAttribute('aria-expanded', String(open));
      };
      const hideTechnical = () => {
        if (!technicalPanel) return;
        technicalPanel.hidden = true;
        setTechnicalToggleState(false);
        scrollToEl($('rtr2b-previews') || publicProof, 'start');
      };
      const toggleTechnical = () => {
        if (!technicalPanel) return;
        const opening = technicalPanel.hidden;
        technicalPanel.hidden = !opening;
        setTechnicalToggleState(opening);
        if (opening) {
          scrollToEl(technicalPanel, 'start');
          flash(technicalPanel);
        } else {
          scrollToEl($('rtr2b-previews') || publicProof, 'start');
        }
      };
      const replayExample = () => {
        syncPromptInputs(samplePromptText);
        updateProofFromInput();
      };
      const startVoice = () => {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) {
          if (intakeStatus) intakeStatus.textContent = 'Voice capture is browser-dependent. Continue by typing or using MAYA’s sample.';
          return;
        }
        const recognition = new Recognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        if (intakeStatus) intakeStatus.textContent = 'Listening. Speak one prompt you want the agent to answer better.';
        recognition.onresult = (event) => { syncPromptInputs(event.results[0][0].transcript); if (intakeStatus) intakeStatus.textContent = 'Voice prompt captured. Press Send to run the calibration rep.'; };
        recognition.onerror = () => { if (intakeStatus) intakeStatus.textContent = 'Voice capture could not start. Continue by typing or using MAYA’s sample.'; };
        recognition.onend = () => { if (intakeStatus && getActivePrompt()) intakeStatus.textContent = 'Voice prompt captured. Press Send to compare default vs ReadTheRoom.'; };
        recognition.start();
      };
      const renderMayaQuestion = () => {
        const q = mayaQuestions[Math.min(mayaGuideIndex, mayaQuestions.length - 1)];
        const done = isCalibrationComplete();
        const progress = $('mayaQuestionProgress');
        const question = $('mayaQuestionText');
        const hint = $('mayaQuestionHint');
        const optionList = $('mayaOptionList');
        const scoreText = $('mayaScoreText');
        const scoreBar = $('mayaScoreBar');
        const changeList = $('mayaChangeList');
        const complete = $('mayaCompleteActions');
        if (!question || !optionList || !scoreText || !scoreBar || !changeList) return;
        if (done) {
          if (progress) progress.textContent = 'Complete';
          question.textContent = 'That is the calibrated behavior profile for this demo.';
          hint.textContent = 'MAYA has enough choices to show the improved answer, the held tool gate, and the reviewed learning receipt.';
          optionList.innerHTML = '';
          setMayaCompleteControls(true);
        } else {
          if (progress) progress.textContent = `Question ${mayaGuideIndex + 1} / ${mayaQuestions.length}`;
          question.textContent = q.question;
          hint.textContent = q.hint;
          optionList.innerHTML = q.options.map((option, index) => `<button class="rtr-maya-option rtr-option-card" type="button" data-option="${index}"><b>${option.label}</b><span>${option.detail}</span></button>`).join('');
          optionList.querySelectorAll('[data-option]').forEach((button) => button.addEventListener('click', () => chooseMayaOption(Number(button.dataset.option))));
          setMayaCompleteControls(false);
        }
        scoreText.textContent = `45 → ${mayaGuideScore}`;
        const scoreState = done ? 'complete' : mayaGuideScore <= 45 ? 'baseline' : mayaGuideScore < 70 ? 'progress' : 'complete';
        scoreText.closest('.rtr-maya-score')?.setAttribute('data-score-state', scoreState);
        scoreBar.style.width = `${Math.min(92, mayaGuideScore)}%`;
        changeList.innerHTML = mayaGuideChanges.length ? mayaGuideChanges.map((item) => `<li>${item}</li>`).join('') : '<li>Waiting for your first calibration choice.</li>';
      };
      const chooseMayaOption = (optionIndex) => {
        const q = mayaQuestions[mayaGuideIndex];
        if (!q) return;
        const selectedQuestionIndex = mayaGuideIndex;
        const selected = q.options[optionIndex] || q.options[0];
        mayaGuideRawLift += Number(selected.lift || 0);
        mayaGuideScore = calculateBehaviorMatchScore(mayaGuideRawLift);
        mayaGuideChanges.push(selected.change);
        mayaGuideIndex += 1;
        flowSteps().forEach((step, index) => step.classList.toggle('done', index <= Math.min(5, mayaGuideIndex + 1)));
        if (intakeStatus) intakeStatus.textContent = `MAYA applied: ${selected.label}. Behavior Match is now 45 → ${mayaGuideScore}.`;
        flash($('mayaGuidePanel'));
        renderMayaQuestion();
        recordBackendChoice(selectedQuestionIndex, q, selected);
      };
      const startMayaWalkthrough = async () => {
        mayaGuideIndex = 0;
        mayaGuideScore = 45;
        mayaGuideRawLift = 0;
        mayaGuideChanges.splice(0, mayaGuideChanges.length);
        mayaSession = null;
        try { localStorage.removeItem(sessionStorageKey); } catch {}
        setMayaCompleteControls(false);
        startCalibrationTimer(Date.now());
        renderMayaQuestion();
        scrollToEl($('mayaGuidePanel'), 'center');
        flash($('mayaGuidePanel'));
        if (intakeStatus) intakeStatus.textContent = 'MAYA walkthrough started. Send reps in the timed lane, or use the behavior choices for faster tuning.';
        setSessionStatus('Session: creating backend-backed local calibration session…');
        await startBackendSession();
      };
      const applyMayaProof = async () => {
        if (!isCalibrationComplete()) {
          setMayaCompleteControls(false);
          if (intakeStatus) intakeStatus.textContent = 'Complete four calibration reps or all four tuning choices before final proof unlocks.';
          renderMayaQuestion();
          scrollToEl($('mayaGuidePanel'), 'center');
          flash($('mayaGuidePanel'));
          return;
        }
        const receipt = await fetchBackendReceipt();
        const finalScore = Math.max(Number(receipt?.behavior_match?.current || mayaGuideScore), 74);
        $('proofPromptText').textContent = getActivePrompt();
        $('proofGenericText').textContent = '“I can make the response clearer and more appropriate for the situation.”';
        $('proofCalibratedText').textContent = '“I’ll keep it human and direct, answer first, hold tools until asked, and save nothing until review.”';
        document.querySelectorAll('.rtr-proof-item.good b')[0].textContent = `45 → ${finalScore}`;
        if (receipt) setSessionStatus(`Session: receipt ready · ${receipt.profile_write?.state || 'review_required'} · saved ${receipt.profile_write?.saved ? 'yes' : 'no'}`);
        scrollToEl(publicProof, 'center');
        flash(publicProof);
      };
      const restartMayaWalkthrough = () => startMayaWalkthrough();
      const downloadReceipt = async () => {
        const receipt = await fetchBackendReceipt();
        const payload = receipt || { product:'ReadTheRoom', powered_by:'2ndNatureAi', mode:'public-proof-sample', input_mode:'voice_or_locked_sample', prompt:getActivePrompt(), generic_response:$('proofGenericText')?.textContent || '', calibrated_response:$('proofCalibratedText')?.textContent || '', behavior_match:{ baseline:42, calibrated:74 }, tool_boundary:'held', profileWrite:{ state:'review_required', saved:false }, profile_writes:'reviewed-only', receipt:'local_exportable' };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'readtheroom-sample-proof-receipt.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 800);
      };
      // MAYA eclipse is a static brand image on the public V5 surface.
      // No stars, assistant preview, ripple, tap state, or parallax on this launch pass.
      $('startCalibrationBtn')?.addEventListener('click', showIntake);
      $('navStartBtn')?.addEventListener('click', showIntake);
      $('seeProofBtn')?.addEventListener('click', replayExample);
      $('focusExampleBtn')?.addEventListener('click', replayExample);
      $('analyzePromptBtn')?.addEventListener('click', runCalibrationRep);
      $('sprintSendBtn')?.addEventListener('click', runCalibrationRep);
      $('samplePromptBtn')?.addEventListener('click', usePromptSample);
      $('sprintUseSampleBtn')?.addEventListener('click', usePromptSample);
      $('calibrationPauseBtn')?.addEventListener('click', pauseCalibrationTimer);
      $('calibrationResumeBtn')?.addEventListener('click', resumeCalibrationTimer);
      $('calibrationSkipBtn')?.addEventListener('click', skipCalibrationLane);
      promptInput?.addEventListener('input', () => { syncPromptInputs(promptInput.value, promptInput); autoGrowPromptInput(promptInput); });
      sprintPromptInput?.addEventListener('input', () => { syncPromptInputs(sprintPromptInput.value, sprintPromptInput); autoGrowPromptInput(sprintPromptInput); });
      $('voicePromptBtn')?.addEventListener('click', startVoice);
      $('technicalProofBtn')?.addEventListener('click', toggleTechnical);
      $('technicalInlineBtn')?.addEventListener('click', toggleTechnical);
      $('technicalCollapseBtn')?.addEventListener('click', hideTechnical);
      $('downloadSampleReceiptBtn')?.addEventListener('click', downloadReceipt);
      $('startTutorialBtn')?.addEventListener('click', startMayaWalkthrough);
      $('mayaApplyProofBtn')?.addEventListener('click', applyMayaProof);
      $('mayaRestartBtn')?.addEventListener('click', restartMayaWalkthrough);

      const setupPrivateArrangeMode = () => {
        const arrangeEnabled = params.get('arrange') === '1';
        const screenshotEnabled = params.get('shot') === '1';
        if (!arrangeEnabled) return;
        document.body.classList.add('rtr-arrange-mode');
        if (screenshotEnabled) document.body.classList.add('rtr-arrange-clean');
        const bucket = Math.round(window.innerWidth / 200) * 200;
        const storageKey = `readtheroom-public-pro-v3-4-arrange:${location.pathname}:${bucket}`;
        const safeJson = (value, fallback = {}) => {
          try { return JSON.parse(value || '') || fallback; } catch { return fallback; }
        };
        let saved = safeJson(localStorage.getItem(storageKey), {});
        const clampMove = (value, limit) => Math.max(-limit, Math.min(limit, value));
        const persist = () => localStorage.setItem(storageKey, JSON.stringify(saved));
        const setStatus = (text) => {
          const el = document.getElementById('rtrArrangeStatus');
          if (el) el.textContent = text;
        };
        const applyCardPosition = (card, pos) => {
          const x = Number(pos?.x || 0);
          const y = Number(pos?.y || 0);
          card.style.transform = `translate(${x}px, ${y}px)`;
          card.dataset.arrangeX = String(Math.round(x));
          card.dataset.arrangeY = String(Math.round(y));
        };
        const cards = Array.from(document.querySelectorAll('[data-arrange-id]'));
        cards.forEach((card) => {
          const id = card.dataset.arrangeId;
          if (!id) return;
          applyCardPosition(card, saved[id] || { x:0, y:0 });
          if (!card.querySelector(':scope > .rtr-arrange-handle')) {
            const handle = document.createElement('span');
            handle.className = 'rtr-arrange-handle';
            handle.textContent = id.replaceAll('-', ' ');
            handle.setAttribute('role', 'button');
            handle.setAttribute('aria-label', `Move ${id.replaceAll('-', ' ')}`);
            card.prepend(handle);
          }
          const handle = card.querySelector(':scope > .rtr-arrange-handle');
          const beginArrangeDrag = (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            document.body.classList.add('rtr-arrange-dragging');
            card.classList.add('is-arrange-dragging');
            handle.setPointerCapture?.(event.pointerId);
            const start = saved[id] || { x:0, y:0 };
            const startX = event.clientX;
            const startY = event.clientY;
            const limitX = Math.max(360, window.innerWidth * .72);
            const limitY = Math.max(360, window.innerHeight * .86);
            const moveType = event.type === 'mousedown' ? 'mousemove' : 'pointermove';
            const upType = event.type === 'mousedown' ? 'mouseup' : 'pointerup';
            const move = (moveEvent) => {
              const next = {
                x: clampMove(Number(start.x || 0) + (moveEvent.clientX - startX), limitX),
                y: clampMove(Number(start.y || 0) + (moveEvent.clientY - startY), limitY)
              };
              saved[id] = next;
              applyCardPosition(card, next);
            };
            const up = () => {
              persist();
              document.body.classList.remove('rtr-arrange-dragging');
              card.classList.remove('is-arrange-dragging');
              window.removeEventListener(moveType, move);
              window.removeEventListener(upType, up);
              setStatus(`Saved ${id}`);
            };
            window.addEventListener(moveType, move);
            window.addEventListener(upType, up, { once:true });
          };
          handle.addEventListener('pointerdown', beginArrangeDrag);
          handle.addEventListener('mousedown', beginArrangeDrag);
        });
        const toolbar = document.createElement('div');
        toolbar.className = 'rtr-arrange-toolbar';
        toolbar.innerHTML = `<b>Arrange mode</b><span id="rtrArrangeStatus">Drag section handles. Positions save locally.</span><button type="button" id="rtrArrangeCopyBtn">Copy layout</button><button type="button" id="rtrArrangeShotBtn">Screenshot mode</button><button type="button" id="rtrArrangeResetBtn">Reset layout</button>`;
        document.body.appendChild(toolbar);
        const exportPayload = () => ({ product:'ReadTheRoom', mode:'private-arrange', route:location.pathname, viewport:{ width:window.innerWidth, height:window.innerHeight, bucket }, savedAt:new Date().toISOString(), positions:saved });
        window.__rtrArrangeExport = exportPayload;
        document.getElementById('rtrArrangeCopyBtn')?.addEventListener('click', async () => {
          const payload = JSON.stringify(exportPayload(), null, 2);
          try {
            await navigator.clipboard.writeText(payload);
            setStatus('Layout JSON copied');
          } catch {
            const blob = new Blob([payload], { type:'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'readtheroom-public-pro-arrange-layout.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 800);
            setStatus('Layout JSON downloaded');
          }
        });
        document.getElementById('rtrArrangeShotBtn')?.addEventListener('click', () => {
          document.body.classList.add('rtr-arrange-clean');
          setStatus('Screenshot mode active. Press Escape to restore handles.');
        });
        document.getElementById('rtrArrangeResetBtn')?.addEventListener('click', () => {
          saved = {};
          localStorage.removeItem(storageKey);
          cards.forEach((card) => applyCardPosition(card, { x:0, y:0 }));
          setStatus('Layout reset');
        });
        window.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            document.body.classList.remove('rtr-arrange-clean');
            setStatus('Handles restored');
          }
        });
      };

      setupPrivateArrangeMode();
      syncPromptInputs(promptInput?.value || samplePromptText);
      autoGrowPromptInput(promptInput);
      autoGrowPromptInput(sprintPromptInput);
      updateCalibrationTimer(0);
      renderMayaQuestion();
      setTechnicalToggleState(false);
      loadPersistedSession();
      if (sandboxStatus) sandboxStatus.textContent = 'off';
    })();

(() => {
  const shell = document.getElementById('rtr-2b-preview-lab');
  if (!shell || shell.dataset.v2InteractionsReady === 'true') return;
  shell.dataset.v2InteractionsReady = 'true';

  const byId = (id) => document.getElementById(id);
  const quickBtn = byId('quickProofModeBtn');
  const fullBtn = byId('fullCalibrationModeBtn');
  const panelFullBtn = byId('switchToFullFromPanelBtn');
  const modeNote = byId('calibrationModeNote');
  const startBtn = byId('startCalibrationBtn');
  const runBtn = byId('analyzePromptBtn');
  const modeTag = byId('calibrationModeTag');

  const setMode = (mode) => {
    const quick = mode !== 'full';
    shell.dataset.calibrationMode = quick ? 'quick' : 'full';
    quickBtn?.classList.toggle('is-active', quick);
    fullBtn?.classList.toggle('is-active', !quick);
    quickBtn?.setAttribute('aria-selected', String(quick));
    fullBtn?.setAttribute('aria-selected', String(!quick));
    if (startBtn) startBtn.textContent = quick ? 'Run the 60-second proof' : 'Start the 15-minute calibration';
    if (runBtn) runBtn.textContent = quick ? 'Run quick proof' : 'Start calibration session';
    if (modeTag) modeTag.textContent = quick ? 'Quick proof · one-prompt mode' : '15-minute calibration';
    if (modeNote) modeNote.textContent = quick
      ? 'One prompt, one preference, one visible before/after. Nothing is saved without review.'
      : 'A guided six-stage calibration for intent, tone, correction handling, tool boundaries, and review.';
    try { localStorage.setItem('readtheroom-public-calibration-mode', quick ? 'quick' : 'full'); } catch {}
  };

  quickBtn?.addEventListener('click', () => setMode('quick'));
  fullBtn?.addEventListener('click', () => setMode('full'));
  panelFullBtn?.addEventListener('click', () => {
    setMode('full');
    byId('calibrationTimeline')?.scrollIntoView({ behavior:'smooth', block:'start' });
  });
  let savedMode = 'quick';
  try { savedMode = localStorage.getItem('readtheroom-public-calibration-mode') || 'quick'; } catch {}
  setMode(savedMode);

  const lens = byId('responseContextLens');
  const defaultBtn = byId('proofDefaultViewBtn');
  const calibratedBtn = byId('proofCalibratedViewBtn');
  const setProofView = (view) => {
    const calibrated = view !== 'default';
    shell.dataset.proofView = calibrated ? 'calibrated' : 'default';
    if (lens) lens.dataset.view = calibrated ? 'calibrated' : 'default';
    defaultBtn?.classList.toggle('is-active', !calibrated);
    calibratedBtn?.classList.toggle('is-active', calibrated);
    defaultBtn?.setAttribute('aria-selected', String(!calibrated));
    calibratedBtn?.setAttribute('aria-selected', String(calibrated));
  };
  defaultBtn?.addEventListener('click', () => setProofView('default'));
  calibratedBtn?.addEventListener('click', () => setProofView('calibrated'));
  setProofView('calibrated');

  if (lens && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    lens.addEventListener('pointermove', (event) => {
      const rect = lens.getBoundingClientRect();
      const px = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const py = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      lens.style.setProperty('--lens-x', `${(px * 100).toFixed(1)}%`);
      lens.style.setProperty('--lens-y', `${(py * 100).toFixed(1)}%`);
      lens.style.setProperty('--tilt-x', `${((.5 - py) * 2.2).toFixed(2)}deg`);
      lens.style.setProperty('--tilt-y', `${((px - .5) * 2.6).toFixed(2)}deg`);
    });
    lens.addEventListener('pointerleave', () => {
      lens.style.setProperty('--tilt-x', '0deg');
      lens.style.setProperty('--tilt-y', '0deg');
    });
  }

  document.querySelectorAll('#rtr-2b-preview-lab [data-magnetic="true"]').forEach((button) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    button.addEventListener('pointermove', (event) => {
      const rect = button.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * .08;
      const y = (event.clientY - rect.top - rect.height / 2) * .10;
      button.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    });
    button.addEventListener('pointerleave', () => { button.style.transform = ''; });
  });

  const syncHeroProof = () => {
    const generic = byId('sprintGenericOutput')?.textContent?.trim();
    const calibrated = byId('sprintCalibratedOutput')?.textContent?.trim();
    if (generic && !generic.startsWith('Send a prompt')) byId('heroGenericResponse').textContent = `“${generic.replace(/^["“]|["”]$/g,'')}”`;
    if (calibrated && !calibrated.startsWith('MAYA will')) byId('heroCalibratedResponse').textContent = `“${calibrated.replace(/^["“]|["”]$/g,'')}”`;
  };
  ['sprintGenericOutput','sprintCalibratedOutput'].forEach((id) => {
    const node = byId(id);
    if (node) new MutationObserver(syncHeroProof).observe(node, { childList:true, characterData:true, subtree:true });
  });

  const whyList = byId('liveWhyChangedList');
  const changeList = byId('mayaChangeList');
  if (whyList && changeList) {
    const syncWhy = () => {
      const items = [...changeList.querySelectorAll('li')].map((li) => li.textContent.trim()).filter(Boolean);
      if (items.length && !items[0].toLowerCase().includes('waiting')) {
        whyList.innerHTML = items.slice(0,4).map((item) => `<li>${item}</li>`).join('');
      }
    };
    new MutationObserver(syncWhy).observe(changeList, { childList:true, subtree:true });
  }
})();
