# Post-freeze addendum section 8 — voice barge-in and the real tool-action state

2026-10-02. Design authority: `01_CANONICAL_SPECS/AYAS_POST_FREEZE_DESIGN_ADDENDUM_V1.md` section 8. This is the retroactive audit of the voice and console code that exists today. It is not Brain UI V2: that is section 14 of the master order, on its own branch, and it will apply section 8 again when it is built.

## What the audit found

| Canonical state | Today | Backed by |
|---|---|---|
| IDLE, LISTENING, THINKING, SPEAKING, ERROR | Present | The voice engine's own state machine (recogniser and speech callbacks) and a chat turn in flight. |
| RECOVERING | Present for voice | The wake adapter's `recovering` and `paused` flags, shown in the presence row. A durable-task recovery is not shown in the console. |
| WAITING_OWNER | Present as the attention state | The snapshot's pending approvals; the label is "Uyarı" and its text says an approval or review is waiting. There is no state named for the owner alone. |
| TOOL_ACTION | **Missing** | The console said "thinking" for the whole turn, including while a tool ran. |
| Barge-in | **Missing** | Recognition is torn down while AYAS speaks (self-hearing protection). The only way to stop a reply was to mute, which also silences every later reply. |

No state was found that is shown without something real behind it, and nothing in the voice or console code can grant an approval, a lease or a budget, or open the execution gate.

## What changed

**Tool-action state.** `streamAyasChat` sends `{ type: "state", state: "tool-action", tool }` when a read-only tool request is handed to the action runtime and `{ type: "state", state: "thinking" }` when that call returns, whatever it returned. It is sent only when a request really is handed over. The stream client passes the two known states to the console and drops anything else; a tool id that is not an id is dropped too. The console keeps the state only while the turn is in flight and clears it when the turn settles. The orb has a `tool` state ("Araç çalışıyor") and the chat line reads "AYAS salt-okunur bir araç çalıştırıyor (…)". The order in which the orb picks its state moved, unchanged, from the component into `deriveBrainCoreLiveState`, a pure function with its own tests.

The event is display only. A client that ignores it (the phone gateway Worker's client path, an older page) loses the label and nothing else.

**Barge-in.** `AyasVoiceEngine.interruptSpeech()` stops the speech at once and, when voice mode is on, listens for the command without asking for the wake word again. The mic button does this while AYAS is speaking, instead of turning voice mode off mid-sentence, and a "sözünü kes" control appears beside the voice line for as long as AYAS speaks. With voice mode off (a typed turn read aloud) the control stops the audio; the mic tap stops it and then starts listening.

It stops audio and nothing else. The voice engine has no handle on a turn, a tool or a stored result, so it cannot cancel or repeat one. While a turn is being answered the engine is not speaking, and `interruptSpeech()` does nothing and returns `false`. Stopping a turn stays the separate "Durdur" control.

## What is still open

- **Acoustic barge-in** (the owner starts talking and AYAS stops by itself) is not built. It needs the microphone open while AYAS speaks, with the device separating its own voice from the owner's, and that can only be judged on a real phone and a real PC microphone. `GAP_OWNER_GATED`: device validation.
- **Browser rendering** of the new state and control has not been seen in a browser from this session. The markup and the state logic are tested; how it looks is an owner check, as for every earlier console change.
- **A state named WAITING_OWNER** and **task recovery in the console** belong to Brain UI V2 (its status rail and its Fault/Recovery tile).
- The tool state is reported when the request is handed to the action runtime, which admits and then runs it. A request the runtime refuses shows the state for the moment that call takes.

## Verification

- Voice 79 scenarios (three new: barge-in, its no-op cases, voice-off and single-shot).
- Console 43 (two new: the live-state function over every input, the chat line and the barge-in control).
- Stream client 11 (one new: states reach the caller, anything else does not, nothing after the terminal event).
- Reasoning 48 (three scenarios extended: state events around a real dispatch, around a refused one, none when no tool is named).
- Negative controls `scripts/smoke-ayas-voice-turn-state-mutations.ts`: 12 of 12 caught, in a 411-file TEMP overlay that is its own Git repository.
- Chat stream 31, mobile voice regression 36, wake adapter 54, unified trace 17, phone runtime 42, context budget 21: unchanged and passing.
- TypeScript, changed-file lint, diff check. No model, container, network, microphone or browser.
