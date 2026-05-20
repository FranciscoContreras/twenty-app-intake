import type { TwentyFieldType } from '../constants/field-map';

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const PHONE_RE = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{3,9}([-\s.][0-9]{1,9})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?)?$/;

export function detectType(value: unknown): TwentyFieldType {
  if (value === null || value === undefined) return 'TEXT';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'number') return 'NUMBER';

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return 'TEXT';
    if (URL_RE.test(s)) return 'LINKS';
    if (EMAIL_RE.test(s)) return 'EMAILS';
    if (PHONE_RE.test(s)) return 'PHONES';
    if (DATE_RE.test(s)) return 'DATE_TIME';
    if (!isNaN(Number(s)) && s !== '') return 'NUMBER';
    return 'TEXT';
  }

  if (Array.isArray(value)) return 'RAW_JSON';
  if (typeof value === 'object') return 'RAW_JSON';

  return 'TEXT';
}
