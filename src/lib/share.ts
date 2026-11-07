// Sharing helpers: a WhatsApp link that opens the chat with the text ready (the user presses
// Send in WhatsApp — nothing is sent on their behalf), and money in words / figures.

/** A Pakistani number in any common form (0300-1234567, +92 300…, 92300…) → 923001234567. */
export function waNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).split(/[\/,;]/)[0].replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0092")) d = d.slice(2);
  if (d.startsWith("03") && d.length === 11) d = "92" + d.slice(1);
  if (d.startsWith("3") && d.length === 10) d = "92" + d;
  return d.length >= 11 ? d : null;
}

/** wa.me link; without a number WhatsApp asks whom to send it to. */
export function waLink(phone: string | null | undefined, text: string): string {
  const n = waNumber(phone);
  return `https://wa.me/${n || ""}?text=${encodeURIComponent(text)}`;
}

export const pkr = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString("en-PK");

/** dd.mm.yyyy for messages */
export const dmy = (d: string | Date | null | undefined) => {
  if (!d) return "";
  const s = typeof d === "string" ? d.slice(0, 10) : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return s.split("-").reverse().join(".");
};

/** PKR amount in words — crore / lakh / thousand. */
export function rupeesInWords(num: number): string {
  num = Math.round(Math.abs(num || 0));
  if (num === 0) return "Zero Rupees Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number): string => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`);
  const three = (n: number): string => {
    const h = Math.floor(n / 100), r = n % 100;
    return `${h ? ones[h] + " Hundred" + (r ? " " : "") : ""}${r ? two(r) : ""}`;
  };
  const parts: string[] = [];
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (num) parts.push(three(num));
  return parts.join(" ").replace(/\s+/g, " ").trim() + " Rupees Only";
}
