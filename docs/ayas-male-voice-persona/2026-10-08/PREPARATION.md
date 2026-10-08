# AYAS male voice — isolated preparation, owner quality pending

Latest owner order allows preparation while Wake V3 is BLOCKED; live activation remains forbidden until Wake PASS, quality acceptance and owner approval. No assistant provider, browser preferences, narration provider, environment, OS voice installation or active process was changed.

Graphify-first reviewed `PiperAudioProvider.ts` and `browserVoiceAdapter.ts` before preparation. The actual assistant uses browser speech synthesis through `AyasVoiceEngine`. Its existing profile already prefers Turkish male voice hints and uses pitch 0.82, rate 1.03, volume 1. Piper is a separate local narration provider. No invented assistant TTS endpoint or seamless Piper/browser integration is claimed. Preserve those sources and their selection/fallback behavior as rollback.

Two isolated Piper profiles were tested on ten original Turkish sentences each, using the installed pinned 22,050 Hz single-speaker DFKI model. Default inference is length 1, noise 0.667, noise-width 0.8; calm evaluation is length 1.03, noise 0.5, noise-width 0.7. No actor voice clone or artificial pitch shifting was used. The DFKI source describes the OT speaker as male; this supports evaluating the derived Piper voice but does not prove perceived timbre or naturalness. [Source speaker](https://github.com/marytts/voice-dfki-ot/blob/master/README.md).

| Measurement, 10 outputs per profile | Existing Piper default | Calm male evaluation |
| --- | --- | --- |
| First PCM p95 | 479.666 ms | 478.853 ms |
| Complete synthesis p95 | 647.308 ms | 510.046 ms |
| Synthesis real-time factor p95 | 0.1461 | 0.1730 |
| Non-silent outputs | 10/10 | 10/10 |
| Near-full-scale samples (absolute amplitude >= 0.999) | 20 | 22 |

These are subprocess measurements on this host, not browser/network playback latency. First PCM can arrive after the sentence is synthesized; no streaming-utterance latency promise follows. Near-full-scale samples are disclosed, not renamed a clipping PASS. Intelligibility, calm delivery, originality, perceived bass and prosody require owner listening; quality is **NOT_APPROVED**. Isolated child-process cancellation completed in 8.835 ms; this is not a browser interruption/device test. An initial local preflight failed on the known non-ASCII argv path issue and was corrected using relative ASCII model/data arguments; existing production path handling already addresses it and was unchanged.

Windows 32/64-bit System.Speech currently exposes David and Zira (English), no Turkish voice. Previously generated Tolga wake fixtures remain synthetic historical data; they do not establish current voice availability. Browser/iPhone inventories and behavior are still device-specific and NOT_TESTED. The existing assistant fallback remains intact.

License and sustainability review:

- DFKI model card identifies dataset license **CC-BY-NC-SA-4.0**. The dataset source confirms that restriction. Therefore this is a restricted non-commercial isolated evaluation candidate, not unrestricted commercial clearance. The repository-level MIT label does not erase the voice-specific condition. [Piper model card](https://huggingface.co/rhasspy/piper-voices/blob/main/tr/tr_TR/dfki/medium/MODEL_CARD), [dataset license](https://github.com/marytts/dfki-ot-data), [license terms](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- Fahrettin's card at immutable revision `c943ef2ef718de2600086f77cb0b3b5353110efd` declares CC0, verified directly from the primary source. The current official Turkish tree contains only DFKI and Fahrettin's current path returns 404. It was not downloaded or selected because continuing availability/provenance cannot be presumed. [Historical card](https://huggingface.co/rhasspy/piper-voices/blob/c943ef2ef718de2600086f77cb0b3b5353110efd/tr/tr_TR/fahrettin/medium/MODEL_CARD).
- The legacy Piper project is archived and its own code license is MIT; the maintained successor is GPL-3.0. No upgrade or licensing migration was attempted. A future maintained-runtime choice needs its separate compatibility/license review. [Legacy license](https://github.com/rhasspy/piper/blob/master/LICENSE.md), [successor](https://github.com/OHF-Voice/piper1-gpl).
- Tolga is listed as Microsoft's Turkish male voice, but current host availability is absent and this does not grant redistribution rights. No voice package was installed. [Microsoft inventory](https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-a-supported-languages-and-voices).

The appropriate available local path for this bounded evaluation is the existing pinned DFKI/Piper pair. A production-ready broadly licensed sustainable male voice is **NOT_SELECTED**. Do not treat license verification of restrictions as promotion approval. Next legitimate gates are owner sample listening, intended-use/license clearance, supported browser/device inventory and playback/interrupt/echo tests, followed by explicit implementation authorization and Wake PASS. No homepage change is needed or authorized.

Raw technical measurements and recipes are in this directory's `evidence/INDEX.json`; only metadata and scripts are committed. All twenty synthetic WAVs remain private in `.graphify/male-voice-persona/2026-10-08/`. No human recording or audio is uploaded to GitHub. The calm sample `ayas-calm-male-evaluation-0.wav` is available for local owner review. Preparation is **TESTED / QUALITY_PENDING**, not deployed and not Master Plan completion.
