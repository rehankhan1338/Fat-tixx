import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/uploads/[...path]/route";
import { deleteUpload, isSafeUploadPath, saveFloorPlanUpload, spreadsheetExt } from "@/lib/uploads";

const zip = (...entries: string[]) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(entries.join("\0"), "latin1")]);
const ole = (...entries: string[]) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from(entries.join("\0"), "utf16le")]);
const XLSX = zip("[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml");
const file = (bytes: Buffer, name: string) => new File([new Uint8Array(bytes)], name);

describe("spreadsheetExt", () => {
  it("recognises Excel workbooks by content, whatever the file is called", () => {
    expect(spreadsheetExt(XLSX, "plan.bin")).toBe("xlsx");
    expect(spreadsheetExt(ole("Root Entry", "Workbook"), "plan.bin")).toBe("xls");
  });

  it("refuses macro-enabled workbooks", () => {
    expect(spreadsheetExt(zip("[Content_Types].xml", "xl/workbook.xml", "xl/vbaProject.bin"), "plan.xlsx")).toBeNull();
    expect(spreadsheetExt(ole("Workbook", "_VBA_PROJECT_CUR"), "plan.xls")).toBeNull();
  });

  it("refuses other Office files and plain archives", () => {
    expect(spreadsheetExt(zip("[Content_Types].xml", "word/document.xml"), "plan.xlsx")).toBeNull();
    expect(spreadsheetExt(zip("evil.exe"), "plan.xlsx")).toBeNull();
    expect(spreadsheetExt(ole("WordDocument"), "plan.xls")).toBeNull();
  });

  it("takes CSV only with the .csv name, text content and a separator", () => {
    expect(spreadsheetExt(Buffer.from("Section,Row,Seat\nA,1,1\n"), "plan.CSV")).toBe("csv");
    expect(spreadsheetExt(Buffer.from("Section,Row,Seat\n"), "plan.txt")).toBeNull();
    expect(spreadsheetExt(Buffer.from("just one word"), "plan.csv")).toBeNull();
    expect(spreadsheetExt(Buffer.from([0x41, 0x2c, 0x00, 0x42]), "plan.csv")).toBeNull();
  });
});

describe("saveFloorPlanUpload", () => {
  const saved: string[] = [];
  beforeAll(() => { delete process.env.BLOB_READ_WRITE_TOKEN; });
  afterEach(async () => { await Promise.all(saved.splice(0).map((p) => deleteUpload(p))); });

  it.each([
    [XLSX, "plan.xlsx", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    [ole("Workbook"), "plan.xls", "xls", "application/vnd.ms-excel"],
    [Buffer.from("Section,Row,Seat\n"), "plan.csv", "csv", "text/csv"],
  ])("stores %#, and serves it back as a download", async (bytes, name, ext, type) => {
    const r = await saveFloorPlanUpload(file(bytes, name));
    saved.push(r.path);
    expect(r.kind).toBe("spreadsheet");
    expect(r.path).toMatch(new RegExp(`^seatmaps/[a-z0-9-]+\.${ext}$`));
    expect(isSafeUploadPath(r.path)).toBe(true);

    const res = await GET(new Request("http://x"), { params: Promise.resolve({ path: r.path.split("/") }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(type);
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("still takes PDFs, and names every accepted type when it refuses a file", async () => {
    const pdf = await saveFloorPlanUpload(file(Buffer.from("%PDF-1.7 test"), "plan.pdf"));
    saved.push(pdf.path);
    expect(pdf.kind).toBe("pdf");
    await expect(saveFloorPlanUpload(file(Buffer.from("not a plan"), "plan.txt"))).rejects.toThrow(/PDF, JPG, PNG, Excel/);
  });
});
