# Conversation-led public app pass

Source: public MAYA-Platform/ReadTheRoom at ccf296c45a2ab7c51672a155f63b33d6dbb5a811.
Scope: actual public HTML/CSS, related literal-copy/design assertions. No runtime JS, policy engine, API, voice implementation, security, private source, or Evolve² changes.

## Design
- Conversation example, Before/After controls, and user boundary lead the experience. No cube.
- Ice, amber, blue-black company continuity with restrained serif headline and existing self-hosted UI fonts.
- Interactive workbench precedes secondary tutorial content.
- Prominent disclosure identifies preset examples/scores as illustrative, not evidence of training or learning.

## Verification
- Baseline: all 30 npm tests passed. Revised: all 30 passed (log attached).
- Original IDs and CSS classes preserved; JS byte-identical (JSON attached).
- Managed Sites preview and CUA desktop at 1331px: no horizontal overflow; Before selected by keyboard Enter; Run quick proof generated the synthetic calibrated answer. Hero and live workbench visually inspected.
- Desktop screenshot delivered separately to parent as rtr-app-desktop.jpg.
- Mobile/device browser check NOT run: supported CUA API did not advertise viewport resizing. Existing breakpoints retained with new 640/1180px overrides. This is a remaining QA requirement, not a claim of device verification.
- Microphone and real-provider integration not tested. No voice recording, live deployment, or external submission performed.
- Existing JS resets certain action labels to “proof” and exposes both response texts in the accessibility tree; this pass does not alter that behavior. Score floor behavior remains unchanged and disclosed.

## Delivery
Local-only commit and patch for Codex review. No push or deploy. Temporary preview dev command was restored; package.json unchanged. Apply this commit to the public repository only. Recheck mobile and full keyboard walkthrough before release.
