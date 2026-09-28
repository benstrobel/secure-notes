// Builds and parses the plain (unencrypted) contents of a minimal
// WordprocessingML (.docx) package -- just enough structure for Word,
// LibreOffice, and Google Docs to open it as a normal document. The
// resulting zip bytes are what encryptAgile() wraps in ECMA-376 Agile
// Encryption.
import JSZip from "jszip";

export interface DocxContent {
  title: string;
  body: string;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function buildDocxPackage(title: string, body: string): Promise<Uint8Array> {
  const paragraphs = body
    .split("\n")
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`)
    .join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${xmlEscape(title)}</dc:title>
</cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Secure Notes</Application>
</Properties>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rootRels);
  zip.file("word/document.xml", documentXml);
  zip.file("docProps/core.xml", coreXml);
  zip.file("docProps/app.xml", appXml);
  return zip.generateAsync({ type: "uint8array" });
}

/**
 * Robust to files re-saved by real Word/LibreOffice too: it reads
 * paragraph/run text out of word/document.xml with a DOM parser rather
 * than assuming our own minimal structure.
 */
export async function parseDocxPackage(zipBytes: Uint8Array): Promise<DocxContent> {
  const zip = await JSZip.loadAsync(zipBytes);

  const documentXml = await zip.file("word/document.xml")?.async("string");
  const coreXml = await zip.file("docProps/core.xml")?.async("string");

  const body = documentXml ? extractBody(documentXml) : "";
  const title = coreXml ? extractTitle(coreXml) : "";
  return { title, body };
}

function extractBody(documentXml: string): string {
  const doc = new DOMParser().parseFromString(documentXml, "application/xml");
  const paragraphs = Array.from(doc.getElementsByTagName("w:p"));
  return paragraphs
    .map((p) => Array.from(p.getElementsByTagName("w:t")).map((t) => t.textContent ?? "").join(""))
    .join("\n");
}

function extractTitle(coreXml: string): string {
  const doc = new DOMParser().parseFromString(coreXml, "application/xml");
  const titleNode = doc.getElementsByTagName("dc:title")[0];
  return titleNode?.textContent ?? "";
}
