export type TwentyFieldType =
  | 'TEXT'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATE_TIME'
  | 'EMAILS'
  | 'PHONES'
  | 'LINKS'
  | 'FULL_NAME'
  | 'ADDRESS'
  | 'SELECT'
  | 'CURRENCY'
  | 'RATING'
  | 'RICH_TEXT'
  | 'RAW_JSON';

export type FieldAction = 'field' | 'note' | 'skip';

export type FieldMapEntry = {
  canonicalName: string;
  twentyType: TwentyFieldType;
  action: FieldAction;
};

/**
 * Normalise an incoming key to its lookup form:
 * camelCase → snake_case, hyphens/spaces → underscores, lowercase.
 * e.g. "phoneNumber" → "phone_number", "E-Mail" → "e_mail"
 */
export function normaliseKey(key: string): string {
  return key
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/[-\s.]/g, '_')
    .replace(/_{2,}/g, '_');
}

export const FIELD_MAP: Record<string, FieldMapEntry> = {
  // ── Phone ─────────────────────────────────────────────────────────────────
  phone:                { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  phone_number:         { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  tel:                  { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  telephone:            { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  mobile:               { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  mobile_number:        { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  cell:                 { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  cell_phone:           { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  contact_phone:        { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  phone1:               { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },
  primary_phone:        { canonicalName: 'phone', twentyType: 'PHONES', action: 'field' },

  // ── Email ─────────────────────────────────────────────────────────────────
  email:                { canonicalName: 'email', twentyType: 'EMAILS', action: 'field' },
  email_address:        { canonicalName: 'email', twentyType: 'EMAILS', action: 'field' },
  e_mail:               { canonicalName: 'email', twentyType: 'EMAILS', action: 'field' },
  contact_email:        { canonicalName: 'email', twentyType: 'EMAILS', action: 'field' },
  email1:               { canonicalName: 'email', twentyType: 'EMAILS', action: 'field' },
  user_email:           { canonicalName: 'email', twentyType: 'EMAILS', action: 'field' },
  primary_email:        { canonicalName: 'email', twentyType: 'EMAILS', action: 'field' },

  // ── First name ────────────────────────────────────────────────────────────
  first_name:           { canonicalName: 'firstName', twentyType: 'TEXT', action: 'field' },
  fname:                { canonicalName: 'firstName', twentyType: 'TEXT', action: 'field' },
  given_name:           { canonicalName: 'firstName', twentyType: 'TEXT', action: 'field' },
  forename:             { canonicalName: 'firstName', twentyType: 'TEXT', action: 'field' },

  // ── Last name ─────────────────────────────────────────────────────────────
  last_name:            { canonicalName: 'lastName', twentyType: 'TEXT', action: 'field' },
  lname:                { canonicalName: 'lastName', twentyType: 'TEXT', action: 'field' },
  surname:              { canonicalName: 'lastName', twentyType: 'TEXT', action: 'field' },
  family_name:          { canonicalName: 'lastName', twentyType: 'TEXT', action: 'field' },

  // ── Full name (will be split on ingest) ───────────────────────────────────
  name:                 { canonicalName: 'fullName', twentyType: 'FULL_NAME', action: 'field' },
  full_name:            { canonicalName: 'fullName', twentyType: 'FULL_NAME', action: 'field' },
  contact_name:         { canonicalName: 'fullName', twentyType: 'FULL_NAME', action: 'field' },
  your_name:            { canonicalName: 'fullName', twentyType: 'FULL_NAME', action: 'field' },

  // ── Company ───────────────────────────────────────────────────────────────
  company:              { canonicalName: 'companyName', twentyType: 'TEXT', action: 'field' },
  company_name:         { canonicalName: 'companyName', twentyType: 'TEXT', action: 'field' },
  business:             { canonicalName: 'companyName', twentyType: 'TEXT', action: 'field' },
  business_name:        { canonicalName: 'companyName', twentyType: 'TEXT', action: 'field' },
  organization:         { canonicalName: 'companyName', twentyType: 'TEXT', action: 'field' },
  organisation:         { canonicalName: 'companyName', twentyType: 'TEXT', action: 'field' },
  employer:             { canonicalName: 'companyName', twentyType: 'TEXT', action: 'field' },
  firm:                 { canonicalName: 'companyName', twentyType: 'TEXT', action: 'field' },

  // ── Website / Domain ──────────────────────────────────────────────────────
  website:              { canonicalName: 'domainName', twentyType: 'LINKS', action: 'field' },
  website_url:          { canonicalName: 'domainName', twentyType: 'LINKS', action: 'field' },
  url:                  { canonicalName: 'domainName', twentyType: 'LINKS', action: 'field' },
  domain:               { canonicalName: 'domainName', twentyType: 'LINKS', action: 'field' },
  homepage:             { canonicalName: 'domainName', twentyType: 'LINKS', action: 'field' },
  web:                  { canonicalName: 'domainName', twentyType: 'LINKS', action: 'field' },
  site:                 { canonicalName: 'domainName', twentyType: 'LINKS', action: 'field' },
  site_url:             { canonicalName: 'domainName', twentyType: 'LINKS', action: 'field' },

  // ── Address ───────────────────────────────────────────────────────────────
  street:               { canonicalName: 'addressStreet1', twentyType: 'TEXT', action: 'field' },
  street_address:       { canonicalName: 'addressStreet1', twentyType: 'TEXT', action: 'field' },
  address_line_1:       { canonicalName: 'addressStreet1', twentyType: 'TEXT', action: 'field' },
  address1:             { canonicalName: 'addressStreet1', twentyType: 'TEXT', action: 'field' },
  address_line_2:       { canonicalName: 'addressStreet2', twentyType: 'TEXT', action: 'field' },
  address2:             { canonicalName: 'addressStreet2', twentyType: 'TEXT', action: 'field' },
  city:                 { canonicalName: 'addressCity', twentyType: 'TEXT', action: 'field' },
  address_city:         { canonicalName: 'addressCity', twentyType: 'TEXT', action: 'field' },
  town:                 { canonicalName: 'addressCity', twentyType: 'TEXT', action: 'field' },
  state:                { canonicalName: 'addressState', twentyType: 'TEXT', action: 'field' },
  province:             { canonicalName: 'addressState', twentyType: 'TEXT', action: 'field' },
  region:               { canonicalName: 'addressState', twentyType: 'TEXT', action: 'field' },
  address_state:        { canonicalName: 'addressState', twentyType: 'TEXT', action: 'field' },
  zip:                  { canonicalName: 'addressPostcode', twentyType: 'TEXT', action: 'field' },
  zip_code:             { canonicalName: 'addressPostcode', twentyType: 'TEXT', action: 'field' },
  postal_code:          { canonicalName: 'addressPostcode', twentyType: 'TEXT', action: 'field' },
  postcode:             { canonicalName: 'addressPostcode', twentyType: 'TEXT', action: 'field' },
  country:              { canonicalName: 'addressCountry', twentyType: 'TEXT', action: 'field' },
  address_country:      { canonicalName: 'addressCountry', twentyType: 'TEXT', action: 'field' },

  // ── Social ────────────────────────────────────────────────────────────────
  linkedin:             { canonicalName: 'linkedInLink', twentyType: 'LINKS', action: 'field' },
  linkedin_url:         { canonicalName: 'linkedInLink', twentyType: 'LINKS', action: 'field' },
  linkedin_profile:     { canonicalName: 'linkedInLink', twentyType: 'LINKS', action: 'field' },
  twitter:              { canonicalName: 'xLink', twentyType: 'LINKS', action: 'field' },
  twitter_url:          { canonicalName: 'xLink', twentyType: 'LINKS', action: 'field' },
  x_profile:            { canonicalName: 'xLink', twentyType: 'LINKS', action: 'field' },

  // ── Pipeline-specific (Google / business intel) ───────────────────────────
  google_places_url:    { canonicalName: 'ext_googlePlacesUrl', twentyType: 'LINKS', action: 'field' },
  places_url:           { canonicalName: 'ext_googlePlacesUrl', twentyType: 'LINKS', action: 'field' },
  google_maps_url:      { canonicalName: 'ext_googlePlacesUrl', twentyType: 'LINKS', action: 'field' },
  maps_url:             { canonicalName: 'ext_googlePlacesUrl', twentyType: 'LINKS', action: 'field' },
  rating:               { canonicalName: 'ext_googleRating', twentyType: 'NUMBER', action: 'field' },
  google_rating:        { canonicalName: 'ext_googleRating', twentyType: 'NUMBER', action: 'field' },
  stars:                { canonicalName: 'ext_googleRating', twentyType: 'NUMBER', action: 'field' },
  review_count:         { canonicalName: 'ext_reviewCount', twentyType: 'NUMBER', action: 'field' },
  reviews_count:        { canonicalName: 'ext_reviewCount', twentyType: 'NUMBER', action: 'field' },
  total_reviews:        { canonicalName: 'ext_reviewCount', twentyType: 'NUMBER', action: 'field' },
  num_reviews:          { canonicalName: 'ext_reviewCount', twentyType: 'NUMBER', action: 'field' },
  marketing_score:      { canonicalName: 'ext_marketingScore', twentyType: 'NUMBER', action: 'field' },
  lead_score:           { canonicalName: 'ext_leadScore', twentyType: 'NUMBER', action: 'field' },
  analyzed_url:         { canonicalName: 'ext_analyzedUrl', twentyType: 'LINKS', action: 'field' },

  // ── UTM — always captured in note ────────────────────────────────────────
  utm_source:           { canonicalName: 'utm_source', twentyType: 'TEXT', action: 'note' },
  utm_medium:           { canonicalName: 'utm_medium', twentyType: 'TEXT', action: 'note' },
  utm_campaign:         { canonicalName: 'utm_campaign', twentyType: 'TEXT', action: 'note' },
  utm_content:          { canonicalName: 'utm_content', twentyType: 'TEXT', action: 'note' },
  utm_term:             { canonicalName: 'utm_term', twentyType: 'TEXT', action: 'note' },
  ref:                  { canonicalName: 'ref', twentyType: 'TEXT', action: 'note' },
  referrer:             { canonicalName: 'referrer', twentyType: 'TEXT', action: 'note' },
  source_page:          { canonicalName: 'source_page', twentyType: 'TEXT', action: 'note' },
  landing_page:         { canonicalName: 'landing_page', twentyType: 'TEXT', action: 'note' },

  // ── Known note fields — always prose ─────────────────────────────────────
  message:              { canonicalName: 'message', twentyType: 'RICH_TEXT', action: 'note' },
  description:          { canonicalName: 'description', twentyType: 'RICH_TEXT', action: 'note' },
  analysis:             { canonicalName: 'analysis', twentyType: 'RICH_TEXT', action: 'note' },
  notes:                { canonicalName: 'notes', twentyType: 'RICH_TEXT', action: 'note' },
  comments:             { canonicalName: 'comments', twentyType: 'RICH_TEXT', action: 'note' },
  summary:              { canonicalName: 'summary', twentyType: 'RICH_TEXT', action: 'note' },
  inquiry:              { canonicalName: 'inquiry', twentyType: 'RICH_TEXT', action: 'note' },
  body:                 { canonicalName: 'body', twentyType: 'RICH_TEXT', action: 'note' },
  details:              { canonicalName: 'details', twentyType: 'RICH_TEXT', action: 'note' },
  content:              { canonicalName: 'content', twentyType: 'RICH_TEXT', action: 'note' },
  text:                 { canonicalName: 'text', twentyType: 'RICH_TEXT', action: 'note' },
  feedback:             { canonicalName: 'feedback', twentyType: 'RICH_TEXT', action: 'note' },
  about:                { canonicalName: 'about', twentyType: 'RICH_TEXT', action: 'note' },
  additional_info:      { canonicalName: 'additional_info', twentyType: 'RICH_TEXT', action: 'note' },

  // ── System / internal — skip entirely ────────────────────────────────────
  _id:                  { canonicalName: '_id', twentyType: 'TEXT', action: 'skip' },
  __v:                  { canonicalName: '__v', twentyType: 'TEXT', action: 'skip' },
  created_at:           { canonicalName: 'createdAt', twentyType: 'DATE_TIME', action: 'skip' },
  updated_at:           { canonicalName: 'updatedAt', twentyType: 'DATE_TIME', action: 'skip' },
  form_id:              { canonicalName: 'form_id', twentyType: 'TEXT', action: 'skip' },
  submission_id:        { canonicalName: 'submission_id', twentyType: 'TEXT', action: 'skip' },
  token:                { canonicalName: 'token', twentyType: 'TEXT', action: 'skip' },
  password:             { canonicalName: 'password', twentyType: 'TEXT', action: 'skip' },
  secret:               { canonicalName: 'secret', twentyType: 'TEXT', action: 'skip' },
} as const;
