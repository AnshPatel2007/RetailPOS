/**
 * The Claude model every AI feature uses: invoice reading, product
 * identification, the daily summary's narrative, report questions and the help
 * assistant. It lives in one place so that a model retirement is a one-line
 * change (a retired model id, hard-coded in one controller, broke invoice
 * scanning in June 2026).
 *
 * AI_MODEL overrides it per deployment. Moving to a newer model family is more
 * than a name change (defaults and accepted request settings differ between
 * families), so follow Anthropic's migration guide and re-test each feature
 * before changing the default here.
 */
export const AI_MODEL = process.env.AI_MODEL?.trim() || 'claude-opus-4-8';
