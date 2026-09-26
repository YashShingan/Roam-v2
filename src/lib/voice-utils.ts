// ─── Voice Interaction Utilities (Wake Word & Stop Phrase Processing) ───

export const WAKE_WORDS_REGEX = /\b(hey\s*vibe|hay\s*vibe|ok\s*vibe|a\s*vibe|k\s*vibe|hey\s*five|hey\s*wipe|hey\s*wide|high\s*vibe|hey\s*roamy|hey\s*romy|hey\s*romi|hey\s*roami|hey\s*rohmi|hey\s*roam|ok\s*roamy|ok\s*romy|hey\s*row\s*me|hey\s*rome|vibe|roamy|romy)\b/i;

export const STOP_PHRASE_REGEX = /\b(that'?s\s*it|that\s*is\s*all|done|plan\s*it|go\s*ahead|that'?s\s*all|wrap\s*it\s*up)\b[.!?,]?\s*$/i;

/**
 * Checks if the spoken transcript contains the hands-free wake word ("Hey Vibe" / "Hey Roamy").
 */
export function matchesWakeWord(text: string): boolean {
  if (!text) return false;
  return WAKE_WORDS_REGEX.test(text);
}

/**
 * Detects if a transcript ends with a stop phrase (e.g. "that's it", "done")
 * and strips it so the AI Agent receives the pristine travel instruction.
 */
export function cleanVoiceTranscript(text: string): { cleaned: string; hasStopPhrase: boolean } {
  if (!text) return { cleaned: "", hasStopPhrase: false };
  const trimmed = text.trim();
  const hasStopPhrase = STOP_PHRASE_REGEX.test(trimmed);

  if (!hasStopPhrase) {
    return { cleaned: trimmed, hasStopPhrase: false };
  }

  // Remove the trailing stop phrase and any trailing punctuation
  const cleaned = trimmed.replace(STOP_PHRASE_REGEX, "").trim().replace(/[,.-]+$/, "").trim();
  return { cleaned, hasStopPhrase: true };
}
