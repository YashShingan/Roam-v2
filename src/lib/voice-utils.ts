// ─── Voice Interaction Utilities (Wake Word & Stop Phrase Processing) ───

export const WAKE_WORDS_REGEX = /\b((?:hey|hay|hai|hi|oye|oe|ok|a|k|ay|aye|eh)\s*(?:vibe|vive|bhai|wipe|wide|five|live|vaib|vyb|roamy|romy|romi|rumi|roami|rohmi|roomie|roomi|roomee|romey|roamit|romit|roam\s*it|roam|rome|romeo|row\s*me|rohit)|hero\s*me|hear\s*me\s*roam|heavy|high\s*vibe|roam\s*it|roamy|roomie|roomi|roami|romy|romey|rumi|roamit|romit)\b/i;

export const STOP_PHRASE_REGEX = /\b(that'?s\s*it|that\s*is\s*all|done|plan\s*it|go\s*ahead|that'?s\s*all|wrap\s*it\s*up)\b[.!?,]?\s*$/i;

/**
 * Checks if the spoken transcript contains the hands-free wake word ("Hey Vibe" / "Hey Roamy").
 */
export function matchesWakeWord(text: string): boolean {
  if (!text) return false;
  return WAKE_WORDS_REGEX.test(text);
}

/**
 * Inspects a transcript for a wake word. If found, extracts the trailing command
 * spoken in the same breath (e.g. "Hey Vibe, plan a 2-day trip to Pune").
 * Strips leading wake words and trailing stop phrases.
 */
export function extractWakeCommand(text: string): { hasWake: boolean; command: string } {
  if (!text) return { hasWake: false, command: "" };
  const match = text.match(WAKE_WORDS_REGEX);
  if (!match || match.index === undefined) {
    return { hasWake: false, command: "" };
  }

  // Extract everything after the wake word match
  const afterWake = text.slice(match.index + match[0].length);
  // Remove leading punctuation (commas, colons, dashes, spaces)
  const sanitized = afterWake.replace(/^[\s,;:\-–—]+/, "").trim();

  if (!sanitized) {
    return { hasWake: true, command: "" };
  }

  // Clean any trailing verbal stop phrases (e.g. "that's it")
  const { cleaned } = cleanVoiceTranscript(sanitized);
  return { hasWake: true, command: cleaned || sanitized };
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

/**
 * Dispatches an event notifying ambient voice listeners that speech playback has started.
 */
export function notifySpeechStart(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("roam:speech-start"));
  }
}

/**
 * Dispatches an event notifying ambient voice listeners that speech playback has ended.
 */
export function notifySpeechEnd(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("roam:speech-end"));
  }
}

/**
 * Plays speech synthesis utterance while safely notifying voice listeners
 * to pause their mic and re-arm when playback finishes.
 */
export function speakWithCoordination(text: string, lang = "en-IN"): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  notifySpeechStart();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.onend = () => notifySpeechEnd();
  u.onerror = () => notifySpeechEnd();
  speechSynthesis.speak(u);
}

/**
 * Dispatches an event notifying all speech synthesizers and audio players to immediately stop.
 */
export function interruptAllSpeech(): void {
  if (typeof window !== "undefined") {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    window.dispatchEvent(new CustomEvent("roam:speech-interrupt"));
    window.dispatchEvent(new CustomEvent("roam:speech-end"));
  }
}


