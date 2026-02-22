// Indian states and union territories
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

// Maharashtra districts (for IGR rate lookup)
export const MAHARASHTRA_DISTRICTS = [
  'Ahmednagar', 'Akola', 'Amravati', 'Aurangabad', 'Beed', 'Bhandara',
  'Buldhana', 'Chandrapur', 'Dhule', 'Gadchiroli', 'Gondia', 'Hingoli',
  'Jalgaon', 'Jalna', 'Kolhapur', 'Latur', 'Mumbai City', 'Mumbai Suburban',
  'Nagpur', 'Nanded', 'Nandurbar', 'Nashik', 'Osmanabad', 'Palghar',
  'Parbhani', 'Pune', 'Raigad', 'Ratnagiri', 'Sangli', 'Satara',
  'Sindhudurg', 'Solapur', 'Thane', 'Wardha', 'Washim', 'Yavatmal',
] as const;

// Gujarat districts (for Jantri rate lookup)
export const GUJARAT_DISTRICTS = [
  'Ahmedabad', 'Amreli', 'Anand', 'Aravalli', 'Banaskantha', 'Bharuch',
  'Bhavnagar', 'Botad', 'Chhota Udaipur', 'Dahod', 'Dang', 'Devbhoomi Dwarka',
  'Gandhinagar', 'Gir Somnath', 'Jamnagar', 'Junagadh', 'Kheda', 'Kutch',
  'Mahisagar', 'Mehsana', 'Morbi', 'Narmada', 'Navsari', 'Panchmahal',
  'Patan', 'Porbandar', 'Rajkot', 'Sabarkantha', 'Surat', 'Surendranagar',
  'Tapi', 'Vadodara', 'Valsad',
] as const;

// Financial year helper
export function getCurrentFinancialYear(): string {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  if (month >= 4) {
    return `${year}-${String(year + 1).slice(2)}`;
  }
  return `${year - 1}-${String(year).slice(2)}`;
}

// Convert number to words (for report final value)
export function numberToWords(num: number): string {
  if (num === 0) return 'Zero';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertChunk(n: number): string {
    if (n === 0) return '';
    if (n < 20) return (ones[n] ?? '') + ' ';
    if (n < 100) return (tens[Math.floor(n / 10)] ?? '') + ' ' + convertChunk(n % 10);
    return (ones[Math.floor(n / 100)] ?? '') + ' Hundred ' + convertChunk(n % 100);
  }

  let result = '';
  if (num >= 10000000) {
    result += convertChunk(Math.floor(num / 10000000)) + 'Crore ';
    num %= 10000000;
  }
  if (num >= 100000) {
    result += convertChunk(Math.floor(num / 100000)) + 'Lakh ';
    num %= 100000;
  }
  if (num >= 1000) {
    result += convertChunk(Math.floor(num / 1000)) + 'Thousand ';
    num %= 1000;
  }
  result += convertChunk(num);

  return `Rupees ${result.trim()} Only`;
}

// CPWD construction cost rates (INR per sq.m.) — updated periodically
export const CPWD_CONSTRUCTION_RATES: Record<string, number> = {
  'RCC_FRAME_A_CLASS': 25000,
  'RCC_FRAME_B_CLASS': 20000,
  'LOAD_BEARING_A_CLASS': 18000,
  'LOAD_BEARING_B_CLASS': 15000,
  'STEEL_STRUCTURE': 22000,
  'INDUSTRIAL_SHED': 12000,
  'COMMERCIAL_COMPLEX': 28000,
};

// Standard useful life of buildings (years) — as per Indian standards
export const BUILDING_USEFUL_LIFE: Record<string, number> = {
  'RCC_FRAME_A_CLASS': 60,
  'RCC_FRAME_B_CLASS': 50,
  'LOAD_BEARING_A_CLASS': 40,
  'LOAD_BEARING_B_CLASS': 30,
  'STEEL_STRUCTURE': 30,
  'INDUSTRIAL_SHED': 25,
  'COMMERCIAL_COMPLEX': 60,
  'DEFAULT': 60,
};
