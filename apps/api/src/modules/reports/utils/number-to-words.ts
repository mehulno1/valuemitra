/**
 * Indian number-to-words converter
 * Produces output like: "Rupees Forty-Five Lakhs Thirty Thousand Only"
 * Uses Indian numbering system (lakh, crore).
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty',
  'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one === 0 ? (TENS[ten] ?? '') : `${TENS[ten]}-${ONES[one]}`;
}

function threeDigits(n: number): string {
  if (n === 0) return '';
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  const hundredPart = hundreds > 0 ? `${ONES[hundreds]} Hundred` : '';
  const remPart = remainder > 0 ? twoDigits(remainder) : '';
  if (hundredPart && remPart) return `${hundredPart} and ${remPart}`;
  return hundredPart || remPart;
}

/**
 * Convert a non-negative integer to Indian words.
 * e.g. 4500000 → "Forty-Five Lakhs"
 *      45030000 → "Four Crores Fifty Lakhs Thirty Thousand"
 */
export function numberToIndianWords(amount: number): string {
  const n = Math.round(Math.abs(amount));

  if (n === 0) return 'Zero';

  const crore = Math.floor(n / 10_000_000);
  const lakh  = Math.floor((n % 10_000_000) / 100_000);
  const thou  = Math.floor((n % 100_000) / 1_000);
  const rest  = n % 1_000;

  const parts: string[] = [];

  if (crore > 0) parts.push(`${threeDigits(crore)} ${crore === 1 ? 'Crore' : 'Crores'}`);
  if (lakh  > 0) parts.push(`${twoDigits(lakh)} ${lakh === 1 ? 'Lakh' : 'Lakhs'}`);
  if (thou  > 0) parts.push(`${twoDigits(thou)} Thousand`);
  if (rest  > 0) parts.push(threeDigits(rest));

  return parts.join(' ');
}

/**
 * Full currency phrase for use in reports.
 * e.g. "Rupees Forty-Five Lakhs Only"
 */
export function rupeesToWords(amount: number): string {
  if (amount === 0) return 'Rupees Zero Only';
  return `Rupees ${numberToIndianWords(amount)} Only`;
}
