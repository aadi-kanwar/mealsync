/**
 * How long someone stays signed in on a device. Shared by the backend (how
 * long a login is valid) and the website (how long the browser keeps the
 * login cookies), so the two always agree.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** A login lasts at most this long, however often Dine is used… */
export const SESSION_TOTAL_MS = 90 * DAY_MS;
/** …and ends sooner if Dine isn't opened on that device for this long. */
export const SESSION_INACTIVE_MS = 30 * DAY_MS;
/** The browser keeps the login cookies this long (seconds), even when the phone closes the browser. */
export const LOGIN_COOKIE_MAX_AGE_SECONDS = SESSION_TOTAL_MS / 1000;
