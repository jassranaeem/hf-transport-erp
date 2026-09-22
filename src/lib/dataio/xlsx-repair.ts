/**
 * Real customer .xlsx files that have been resaved dozens of times over
 * years in Excel can end up with a corrupt "definedName" entry — most
 * commonly a Print Area pointing at a range that got deleted, which Excel
 * itself happily leaves as `'SheetName'!#REF!` instead of removing. ExcelJS's
 * own cell-range parser (`decodeEx` in exceljs/lib/utils/col-cache.js) throws
 * a bare `Cannot read properties of undefined (reading 'match')` the moment
 * it hits one of these while loading the workbook — before any of this app's
 * own code ever runs, so there's nothing to catch it downstream. One
 * genuinely real file in this session's real-data import hit exactly this
 * (a `_xlnm.Print_Area` defined name whose target was `#REF!`).
 *
 * Fix: strip only the broken `#REF!` defined-name entries from the raw
 * workbook.xml before handing the buffer to ExcelJS. Everything else in the
 * file — every sheet, every real cell — is untouched; a lost Print Area
 * setting is a cosmetic printing preference, not data.
 */
import JSZip from "jszip";

export async function repairXlsxBuffer(buffer: Buffer): Promise<Buffer> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const wbXmlFile = zip.file("xl/workbook.xml");
    if (!wbXmlFile) return buffer;
    const xml = await wbXmlFile.async("string");
    // Strip every Print_Area / Print_Titles defined name wholesale, not just
    // ones literally containing "#REF!". A single confirmed #REF! case
    // turned out not to be the only way this breaks: a sheet name that is
    // itself mostly/only commas (a real pattern in this data — sheets named
    // things like "S,H,E,E,T,") gets its print-area range mis-split by
    // ExcelJS's own comma-separated-ranges parser, landing it in the same
    // "ranges[0] is undefined" crash with no literal #REF! text to grep for.
    // Print Area/Titles are a paper-printing preference, not data — losing
    // them is a no-op for what this app actually does with the file.
    const repaired = xml.replace(
      /<definedName\b[^>]*\bname="_xlnm\.Print_(?:Area|Titles)"[^>]*>[\s\S]*?<\/definedName>/g,
      "",
    );
    if (repaired === xml) return buffer; // nothing to repair — return the original untouched
    zip.file("xl/workbook.xml", repaired);
    const out = await zip.generateAsync({ type: "nodebuffer" });
    return out;
  } catch {
    // repair is best-effort only — if it fails for any reason, hand back the
    // original buffer and let the normal (pre-existing) error path handle it
    return buffer;
  }
}
