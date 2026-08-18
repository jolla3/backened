// utils/smsSegments.js
function calculateSmsSegments(text) {
  if (!text) return { encoding: 'gsm7', segments: 0, length: 0 };

  // Simplified: if any non-GSM7 char → UCS2
  const gsm7 =
    /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !"#¤%&'()*+,\-.\/0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà\r\n]*$/;
  const isGsm7 = gsm7.test(text);
  const length = text.length;

  if (isGsm7) {
    if (length <= 160) return { encoding: 'gsm7', segments: 1, length };
    return { encoding: 'gsm7', segments: Math.ceil(length / 153), length };
  }
  if (length <= 70) return { encoding: 'ucs2', segments: 1, length };
  return { encoding: 'ucs2', segments: Math.ceil(length / 67), length };
}

module.exports = { calculateSmsSegments };