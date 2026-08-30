/**
 * Email domains that identify a person, not an employer.
 *
 * A consumer mailbox says nothing about who someone works for. Turning
 * `jane@gmail.com` into a company called "gmail.com" is the single fastest way
 * to make a CRM untrustworthy: most small-business enquiries arrive from a free
 * provider, so one webhook wired to a busy form quietly fills the Companies
 * table with mail hosts and attaches real people to them.
 *
 * Intake never derives a company from an email domain at all — see the note in
 * README under "Companies from email domains". This list exists so that the
 * places where a domain *does* drive a decision — company dedup, and the
 * domainName written onto a company record — refuse to act on a mailbox host
 * that arrived as a website or domain field.
 *
 * The list is deliberately the common providers rather than an exhaustive
 * disposable-address feed. It has to be cheap to read on every ingestion and
 * easy to audit; a missed niche provider costs one junk company that a person
 * can merge, whereas a wrong entry silently discards a real customer's domain.
 */
const FREE_EMAIL_DOMAINS = new Set<string>([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'outlook.com', 'outlook.co.uk', 'outlook.fr', 'outlook.de', 'outlook.es',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it', 'hotmail.es',
  'live.com', 'live.co.uk', 'live.nl', 'msn.com', 'passport.com',
  // Yahoo
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.jp', 'yahoo.ca', 'yahoo.com.au',
  'yahoo.de', 'yahoo.fr', 'yahoo.es', 'yahoo.it', 'yahoo.in', 'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // AOL / Verizon / legacy US ISPs — common on older consumer accounts
  'aol.com', 'aim.com', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net',
  'comcast.net', 'cox.net', 'charter.net', 'earthlink.net', 'juno.com', 'netzero.net',
  'roadrunner.com', 'rr.com', 'optonline.net', 'frontier.com', 'windstream.net',
  // Privacy-oriented providers
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'tutanota.com', 'tutanota.de', 'tuta.io', 'tuta.com',
  'hushmail.com', 'fastmail.com', 'fastmail.fm', 'posteo.de', 'mailbox.org',
  // Other large free providers
  'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch',
  'mail.com', 'email.com', 'usa.com', 'inbox.com',
  'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'ya.ru',
  'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'rambler.ru',
  'qq.com', 'foxmail.com', '163.com', '126.com', 'sina.com', 'sina.cn', 'sohu.com',
  'naver.com', 'hanmail.net', 'daum.net', 'nate.com',
  'seznam.cz', 'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl',
  'libero.it', 'virgilio.it', 'alice.it', 'tiscali.it',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'bbox.fr', 'neuf.fr',
  'web.de', 't-online.de', 'freenet.de', 'arcor.de',
  'btinternet.com', 'sky.com', 'talktalk.net', 'virginmedia.com', 'ntlworld.com',
  'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'iinet.net.au', 'xtra.co.nz',
  'terra.com.br', 'uol.com.br', 'bol.com.br', 'ig.com.br',
  'rediffmail.com', 'sify.com', 'indiatimes.com',
  // Throwaway / disposable services — never a real employer
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com',
  '10minutemail.com', 'temp-mail.org', 'tempmail.com', 'throwawaymail.com',
  'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com',
  'maildrop.cc', 'mintemail.com', 'fakeinbox.com', 'spamgourmet.com',
  'mailnesia.com', 'moakt.com', 'emailondeck.com', 'burnermail.io',
  'anonaddy.com', 'simplelogin.io', 'duck.com', 'relay.firefox.com',
  // Placeholder domains that show up in test and pasted payloads
  'example.com', 'example.org', 'example.net', 'test.com', 'localhost',
]);

/**
 * Whether a host belongs to a mail provider rather than a business.
 *
 * Accepts a bare host, a host with `www.`, or anything `extractHost` produced.
 * Matching is case-insensitive and ignores a trailing dot.
 */
export function isFreeEmailDomain(host: string): boolean {
  const normalised = host.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!normalised) return false;
  return FREE_EMAIL_DOMAINS.has(normalised);
}

export { FREE_EMAIL_DOMAINS };
