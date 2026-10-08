/*
 * The one piece of free text that reaches the model is the optional sentence
 * the adult types about tastes (docs/SPEC.md, section 5). Before it is sent,
 * anything that looks like an email address, a phone number or a web address
 * is removed, and the rest is cut to 600 characters.
 */

/** Longest taste sentence, in characters. */
export const MAX_SENTENCE = 600;

const EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\]]+/g;
const URL_WITH_SCHEME = /\b(?:https?|ftp):\/\/\S+/gi;
const URL_WWW = /\bwww\.\S+/gi;
const BARE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|edu|gov|io|co|uk|me|tv|app|dev|info|biz|us|ca|au|de|fr|ie|nz)\b(?:\/\S*)?/gi;
/** A run of digits that may be spaced or dotted like a phone number. */
const PHONE = /\+?\(?\d[\d\s().-]{5,}\d/g;
const MIN_PHONE_DIGITS = 7;

const digitCount = (text: string): number => text.replace(/\D/g, '').length;

/**
 * Removes email addresses, web addresses and phone numbers, folds white space,
 * and cuts to 600 characters. A year or a title with a number in it is kept: a
 * run of digits is a phone number only from seven digits up.
 */
export function scrubSentence(text: string): string {
  const cleaned = text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(EMAIL, ' ')
    .replace(URL_WITH_SCHEME, ' ')
    .replace(URL_WWW, ' ')
    .replace(BARE_DOMAIN, ' ')
    .replace(PHONE, (match) => (digitCount(match) >= MIN_PHONE_DIGITS ? ' ' : match))
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.slice(0, MAX_SENTENCE).trim();
}
