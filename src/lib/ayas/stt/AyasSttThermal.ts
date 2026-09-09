/**
 * AYAS STT — GPU thermal guard (Voice Closure Sprint).
 *
 * Whisper transcription is a GPU burst. It rides the SAME hard-stop the Brain
 * worker cycle already respects (`evaluateBrainResourceHardStop`, 60 °C on the
 * A2000). If the GPU is at/over the hard stop, STT refuses to spawn and the
 * caller falls back to "type your command" — the guard is never bypassed.
 *
 * An unreadable GPU does NOT block STT (the probe is best-effort telemetry, and
 * blocking every transcription on a missing `nvidia-smi` would be worse); it is
 * surfaced in the diagnostics instead. Only a *measured* over-limit temperature
 * holds.
 */

import { probeBrainResources } from "@/lib/brain/probe/BrainResourceProbe";
import { evaluateBrainResourceHardStop } from "@/lib/brain/probe/BrainResourceProbe";
import { resolveBrainHardwareProfile } from "@/lib/brain/BrainSafetyGovernor";
import { resolveBrainHardwareProfileId } from "@/lib/brain/ui/BrainConsoleSnapshot";

/** `null` → clear to transcribe; a string → the reason transcription is held. */
export async function ayasSttThermalHold(): Promise<string | null> {
  try {
    const profileId = resolveBrainHardwareProfileId();
    const profile = resolveBrainHardwareProfile(profileId);
    const snapshot = await probeBrainResources();
    const hardStop = evaluateBrainResourceHardStop(snapshot, { id: profile.id, label: profile.label });
    return hardStop.tripped ? hardStop.reason : null;
  } catch {
    // Guard resolution itself failed — do not wedge STT on it.
    return null;
  }
}
