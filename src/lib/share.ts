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
