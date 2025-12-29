import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { llmLogger } from './utils/llmLogger.js';

// Setup DOMPurify
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Configuration for input limits (these can be moved to a config file if needed)
const MAX_INPUT_LENGTH = 2000; // Example: Max characters
const MAX_WORD_COUNT = 300;   // Example: Max words

export function processUserInput(input, userId) {
    if (typeof input !== 'string') {
        llmLogger.warn(`User input is not a string for userId: ${userId}. Type: ${typeof input}`);
        return '';
    }

    let processedInput = input;
    const sanitizationChanges = [];

    // 1. Basic Hygiene Sanitization (remove script tags, normalize delimiters)
    const cleanInput = DOMPurify.sanitize(processedInput, { USE_PROFILES: { html: false } });
    if (cleanInput !== processedInput) {
        sanitizationChanges.push(`HTML tags removed/sanitized.`);
        processedInput = cleanInput;
    }

    // Normalize delimiters (example: replace multiple spaces with single, trim)
    const normalizedInput = processedInput.replace(/\s+/g, ' ').trim();
    if (normalizedInput !== processedInput) {
        sanitizationChanges.push(`Whitespace normalized.`);
        processedInput = normalizedInput;
    }

    // 2. Input Length and Complexity Limits
    if (processedInput.length > MAX_INPUT_LENGTH) {
        const truncatedInput = processedInput.substring(0, MAX_INPUT_LENGTH);
        sanitizationChanges.push(`Input truncated from ${processedInput.length} to ${MAX_INPUT_LENGTH} characters.`);
        processedInput = truncatedInput;
        llmLogger.warn(`Input length exceeded for userId: ${userId}. Truncated.`);
    }

    const wordCount = processedInput.split(/\s+/).filter(Boolean).length;
    if (wordCount > MAX_WORD_COUNT) {
        // Simple word count truncation. For more sophisticated, might need tokenization.
        const words = processedInput.split(/\s+/).filter(Boolean);
        const truncatedWords = words.slice(0, MAX_WORD_COUNT);
        const truncatedInput = truncatedWords.join(' ');
        sanitizationChanges.push(`Input truncated from ${wordCount} to ${MAX_WORD_COUNT} words.`);
        processedInput = truncatedInput;
        llmLogger.warn(`Input word count exceeded for userId: ${userId}. Truncated.`);
    }

    if (sanitizationChanges.length > 0) {
        llmLogger.info(`User input sanitized for userId: ${userId}. Changes: ${sanitizationChanges.join('; ')}`);
    }

    return processedInput;
}
