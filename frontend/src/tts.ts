/**
 * Text-to-Speech utility module using Web Speech API (SpeechSynthesis)
 */

/**
 * Speaks the given text using the Web Speech API
 * @param text - The text to speak
 * @param options - Optional configuration for speech synthesis
 */
export function speak(
  text: string,
  options?: {
    rate?: number;
    pitch?: number;
    volume?: number;
    lang?: string;
  }
): void {
  if (!('speechSynthesis' in window)) {
    console.warn('Web Speech API (SpeechSynthesis) not supported in this browser.');
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  
  // Apply options if provided
  if (options) {
    if (options.rate !== undefined) utterance.rate = options.rate;
    if (options.pitch !== undefined) utterance.pitch = options.pitch;
    if (options.volume !== undefined) utterance.volume = options.volume;
    if (options.lang !== undefined) utterance.lang = options.lang;
  }

  // Default settings for clarity
  utterance.rate = options?.rate ?? 1.0;
  utterance.pitch = options?.pitch ?? 1.0;
  utterance.volume = options?.volume ?? 1.0;
  utterance.lang = options?.lang ?? 'en-US';

  window.speechSynthesis.speak(utterance);
}

/**
 * Speaks feedback for successful task creation
 */
export function speakTaskCreated(): void {
  speak('Task created!');
}

/**
 * Speaks feedback when voice input is ambiguous
 */
export function speakAmbiguousInput(): void {
  speak("I didn't quite catch that. Can you please rephrase?");
}

/**
 * Cancels any ongoing speech
 */
export function cancelSpeech(): void {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Checks if speech synthesis is currently speaking
 */
export function isSpeaking(): boolean {
  if ('speechSynthesis' in window) {
    return window.speechSynthesis.speaking;
  }
  return false;
}
