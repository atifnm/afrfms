import PDFDocument from "pdfkit";
import type { Response } from "express";
import type { ShiftReportSnapshot } from "./shiftReportSnapshot";

const BRAND_GREEN = "#00401A";
const BRAND_GOLD = "#CAA202";
const INK = "#14181A";
const GREY = "#5C6B63";
const CRITICAL = "#C1272D";

export interface ShiftReportPdfData {
  airportName: string;
  shiftDate: string;
  shiftType: string;
  generatedByName: string;
  generatedAt: string;
  summary: string | null;
  fleetHealthScore: number;
  vehiclesInspected: number;
  vehiclesException: number;
  faultsRaisedCritical: number;
  faultsRaisedMinor: number;
  faultsResolved: number;
  snapshot: ShiftReportSnapshot;
}

const COLS = [
  { key: "regNo", label: "Vehicle", width: 60 },
  { key: "category", label: "Category", width: 70 },
  { key: "status", label: "Status", width: 62 },
  { key: "checkedBy", label: "Checked By", width: 72 },
  { key: "prevOdo", label: "Prev. Odo.", width: 55 },
  { key: "currOdo", label: "Curr. Odo.", width: 55 },
  { key: "faults", label: "Faults / Rectified", width: 121 },
];
const TABLE_WIDTH = COLS.reduce((sum, c) => sum + c.width, 0);
const MARGIN = 40;
const ROW_MIN_HEIGHT = 20;
const FOOTER_RESERVE = 36; // vertical space reserved at the bottom of every page for the footer

function shiftStatusLabel(s: string): string {
  if (s === "completed") return "Inspected";
  if (s === "exception") return "Exception";
  return "Not assigned";
}

// Every call site passes an explicit x — never relies on wherever the
// cursor happened to be left by a previous multi-column block (that was
// the root cause of an earlier layout bug: text after the stats row kept
// inheriting the rightmost stat column's x position and wrapping in a
// narrow strip instead of using the full page width).
function line(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  opts: PDFKit.Mixins.TextOptions & { bold?: boolean; size?: number; color?: string } = {}
) {
  doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica");
  doc.fontSize(opts.size ?? 10);
  doc.fillColor(opts.color ?? INK);
  doc.text(text, x, doc.y, { width: opts.width, align: opts.align, lineBreak: opts.lineBreak });
}

export function renderShiftReportPdf(res: Response, data: ShiftReportPdfData) {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="shift-handover-${data.airportName.replace(/\s+/g, "_")}-${data.shiftDate}-${data.shiftType}.pdf"`
  );
  doc.pipe(res);

  // --- Header ---
  line(doc, "SHIFT HANDOVER REPORT", MARGIN, { bold: true, size: 18, color: BRAND_GREEN, width: TABLE_WIDTH });
  doc.moveDown(0.15);
  line(doc, "Pakistan Airport Authority — Fire & Rescue Services", MARGIN, { size: 10, color: GREY, width: TABLE_WIDTH });
  doc.moveDown(0.5);

  doc
    .strokeColor(BRAND_GOLD)
    .lineWidth(1.5)
    .dash(3, { space: 2 })
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + TABLE_WIDTH, doc.y)
    .stroke()
    .undash();
  doc.moveDown(0.6);

  line(doc, data.airportName, MARGIN, { bold: true, size: 11, width: TABLE_WIDTH });
  doc.moveDown(0.15);
  line(doc, `${data.shiftType[0].toUpperCase()}${data.shiftType.slice(1)} shift — ${data.shiftDate}`, MARGIN, {
    size: 10,
    color: GREY,
    width: TABLE_WIDTH,
  });
  doc.moveDown(0.1);
  line(doc, `Issued by ${data.generatedByName} on ${data.generatedAt}`, MARGIN, { size: 10, color: GREY, width: TABLE_WIDTH });
  doc.moveDown(0.7);

  // --- Summary stats ---
  const statY = doc.y;
  const stats: [string, string][] = [
    ["Fleet Health", `${data.fleetHealthScore}`],
    ["Inspected", `${data.vehiclesInspected}`],
    ["Exceptions", `${data.vehiclesException}`],
    ["Critical Faults", `${data.faultsRaisedCritical}`],
    ["Minor Faults", `${data.faultsRaisedMinor}`],
    ["Resolved", `${data.faultsResolved}`],
  ];
  const statWidth = TABLE_WIDTH / stats.length;
  stats.forEach(([label, value], i) => {
    const x = MARGIN + i * statWidth;
    doc.font("Helvetica-Bold").fontSize(16).fillColor(BRAND_GREEN).text(value, x, statY, { width: statWidth, align: "center" });
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(GREY)
      .text(label.toUpperCase(), x, statY + 20, { width: statWidth, align: "center" });
  });
  // Explicitly reset the cursor to the left margin, one line below the
  // tallest stat cell — this is the fix for the cursor-leak bug.
  doc.x = MARGIN;
  doc.y = statY + 42;

  // --- Team Leader's handover comments ---
  if (data.summary) {
    line(doc, "Shift Leader's Comments", MARGIN, { bold: true, size: 10, width: TABLE_WIDTH });
    doc.moveDown(0.2);
    line(doc, data.summary, MARGIN, { size: 9.5, width: TABLE_WIDTH });
    doc.x = MARGIN;
    doc.moveDown(0.6);
  }

  // --- Equipment table ---
  line(doc, "Fleet Status", MARGIN, { bold: true, size: 11, width: TABLE_WIDTH });
  doc.x = MARGIN;
  doc.moveDown(0.25);
  drawTableHeader(doc);

  for (const eq of data.snapshot.equipment) {
    const faultLines =
      eq.faults.length === 0
        ? ["—"]
        : eq.faults.map((f) => `${f.severity === "critical" ? "[CRIT] " : ""}${f.description} — ${f.rectified ? "Rectified" : "Open"}`);

    const crewLines = [
      eq.checkedBy ? `${eq.checkedBy} (Driver)` : null,
      eq.supervisorOnDuty ? `${eq.supervisorOnDuty} (Supv.)` : null,
      eq.superintendentOnDuty ? `${eq.superintendentOnDuty} (Supt.)` : null,
    ].filter((x): x is string => !!x);

    const rowValues: Record<string, string> = {
      regNo: eq.regNo,
      category: eq.category,
      status: eq.exceptionReason ? `Exception: ${eq.exceptionReason}` : shiftStatusLabel(eq.shiftStatus),
      checkedBy: crewLines.length > 0 ? crewLines.join("\n") : "—",
      prevOdo: eq.previousOdometer !== null ? eq.previousOdometer.toLocaleString() : "—",
      currOdo: eq.currentOdometer.toLocaleString(),
      faults: faultLines.join("\n"),
    };

    doc.fontSize(8.5);
    const rowHeight = Math.max(ROW_MIN_HEIGHT, ...COLS.map((c) => doc.heightOfString(rowValues[c.key], { width: c.width - 6 }) + 8));

    if (doc.y + rowHeight > doc.page.height - MARGIN - FOOTER_RESERVE) {
      doc.addPage();
      doc.x = MARGIN;
      drawTableHeader(doc);
    }

    const rowY = doc.y;
    let x = MARGIN;
    const hasCritical = eq.faults.some((f) => f.severity === "critical" && !f.rectified);
    for (const col of COLS) {
      doc
        .fillColor(hasCritical && col.key === "faults" ? CRITICAL : INK)
        .font("Helvetica")
        .fontSize(8.5)
        .text(rowValues[col.key], x + 3, rowY + 4, { width: col.width - 6 });
      x += col.width;
    }
    doc
      .strokeColor("#E1E4DF")
      .lineWidth(0.5)
      .moveTo(MARGIN, rowY + rowHeight)
      .lineTo(MARGIN + TABLE_WIDTH, rowY + rowHeight)
      .stroke();
    doc.x = MARGIN;
    doc.y = rowY + rowHeight;
  }

  // --- Signature block ---
  const SIGNATURE_BLOCK_HEIGHT = 90;
  if (doc.y + SIGNATURE_BLOCK_HEIGHT > doc.page.height - MARGIN - FOOTER_RESERVE) {
    doc.addPage();
    doc.x = MARGIN;
  }
  doc.moveDown(1.5);
  const sigY = doc.y;
  const sigColWidth = TABLE_WIDTH / 2 - 10;
  const sig2X = MARGIN + TABLE_WIDTH / 2 + 10;

  line(doc, "Current Shift Leader", MARGIN, { bold: true, size: 10, width: sigColWidth });
  doc.font("Helvetica").fontSize(9).fillColor(GREY).text(data.snapshot.currentShiftLeaderName ?? "—", MARGIN, sigY + 14, { width: sigColWidth });
  doc
    .strokeColor(INK)
    .lineWidth(0.75)
    .moveTo(MARGIN, sigY + 55)
    .lineTo(MARGIN + sigColWidth, sigY + 55)
    .stroke();
  doc.font("Helvetica").fontSize(8).fillColor(GREY).text("Signature & Date", MARGIN, sigY + 58, { width: sigColWidth });

  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Previous Shift Leader", sig2X, sigY, { width: sigColWidth });
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(GREY)
    .text(data.snapshot.previousShiftLeaderName ?? "N/A (first shift on record)", sig2X, sigY + 14, { width: sigColWidth });
  doc
    .strokeColor(INK)
    .lineWidth(0.75)
    .moveTo(sig2X, sigY + 55)
    .lineTo(sig2X + sigColWidth, sigY + 55)
    .stroke();
  doc.font("Helvetica").fontSize(8).fillColor(GREY).text("Signature & Date", sig2X, sigY + 58, { width: sigColWidth });

  // --- Footer page numbers (drawn last, once page count is final) ---
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(GREY)
      .text(`Page ${i + 1} of ${pageCount} — Confidential, PAA internal use only`, MARGIN, doc.page.height - MARGIN - 12, {
        width: TABLE_WIDTH,
        align: "center",
        lineBreak: false,
      });
  }

  doc.end();
}

function drawTableHeader(doc: PDFKit.PDFDocument) {
  const y = doc.y;
  let x = MARGIN;
  doc.rect(MARGIN, y, TABLE_WIDTH, 18).fill(BRAND_GREEN);
  for (const col of COLS) {
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8).text(col.label, x + 3, y + 5, { width: col.width - 6 });
    x += col.width;
  }
  doc.x = MARGIN;
  doc.y = y + 18;
  doc.fillColor(INK);
}
