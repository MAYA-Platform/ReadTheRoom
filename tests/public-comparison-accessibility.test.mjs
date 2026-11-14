import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

test('comparison tabs expose only the active response and support keyboard navigation', () => {
  let focused = null;
  function element() {
    const attributes = new Map(), listeners = new Map();
    return { attributes, listeners, dataset: {}, classList: { toggle() {} },
      setAttribute(name, value) { attributes.set(name, value); },
      addEventListener(name, callback) { listeners.set(name, callback); },
      focus() { focused = this; } };
  }
  const ids = ['rtr-2b-preview-lab', 'quickProofModeBtn', 'fullCalibrationModeBtn',
    'startCalibrationBtn', 'analyzePromptBtn', 'calibrationModeTag',
    'proofDefaultViewBtn', 'proofCalibratedViewBtn', 'heroDefaultPanel', 'heroCalibratedPanel'];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  let initialShell = true;
  const document = { getElementById(id) {
    // The first application initializer has many unrelated runtime dependencies.
    if (id === 'rtr-2b-preview-lab' && initialShell) { initialShell = false; return null; }
    return elements[id] || null;
  }, querySelectorAll() { return []; } };
  runInNewContext(readFileSync('read-the-room-public-pro/readtheroom-public-pro.js', 'utf8'), {
    document, localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: true })
  });
  const before = elements.proofDefaultViewBtn, after = elements.proofCalibratedViewBtn;
  const left = elements.heroDefaultPanel, right = elements.heroCalibratedPanel;
  assert.equal(elements.startCalibrationBtn.textContent, 'Try a conversation');
  assert.equal(elements.analyzePromptBtn.textContent, 'Run comparison');
  elements.fullCalibrationModeBtn.listeners.get('click')();
  assert.equal(elements.startCalibrationBtn.textContent, 'Start guided calibration');
  assert.equal(elements.fullCalibrationModeBtn.attributes.get('tabindex'), '0');
  assert.equal(elements.quickProofModeBtn.attributes.get('tabindex'), '-1');
  elements.quickProofModeBtn.listeners.get('click')();
  assert.equal(elements.startCalibrationBtn.textContent, 'Try a conversation');
  let modePrevented = false;
  elements.quickProofModeBtn.listeners.get('keydown')({ key: 'ArrowRight', preventDefault() { modePrevented = true; } });
  assert.equal(modePrevented, true);
  assert.equal(focused, elements.fullCalibrationModeBtn);
  assert.equal(elements.fullCalibrationModeBtn.attributes.get('aria-selected'), 'true');
  assert.equal(elements.quickProofModeBtn.attributes.get('tabindex'), '-1');
  elements.fullCalibrationModeBtn.listeners.get('keydown')({ key: 'Home', preventDefault() {} });
  assert.equal(focused, elements.quickProofModeBtn);
  assert.equal(elements.quickProofModeBtn.attributes.get('aria-selected'), 'true');
  assert.equal(before.attributes.get('aria-selected'), 'false');
  assert.equal(left.attributes.get('aria-hidden'), 'true');
  assert.equal(right.attributes.get('aria-hidden'), 'false');
  let prevented = false;
  after.listeners.get('keydown')({ key: 'ArrowLeft', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(focused, before);
  assert.equal(before.attributes.get('tabindex'), '0');
  assert.equal(after.attributes.get('tabindex'), '-1');
  assert.equal(before.attributes.get('aria-selected'), 'true');
  assert.equal(left.attributes.get('aria-hidden'), 'false');
  assert.equal(right.attributes.get('aria-hidden'), 'true');
  before.listeners.get('keydown')({ key: 'End', preventDefault() {} });
  assert.equal(focused, after);
  assert.equal(left.attributes.get('aria-hidden'), 'true');
  assert.equal(right.attributes.get('aria-hidden'), 'false');
});
