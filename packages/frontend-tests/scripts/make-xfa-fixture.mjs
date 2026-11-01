// Generates a small, self-authored dynamic-XFA PDF (MIT, no third-party content). Like real LiveCycle/AEM forms it has
// an empty AcroForm with /XFA, /NeedsRendering true and a single "Please wait..." placeholder page that non-XFA viewers show.
import { PDFDocument, PDFName, PDFArray, PDFString, StandardFonts } from "pdf-lib";

const TEMPLATE = `<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
<subform name="form1" layout="tb" locale="en_US" restoreState="auto">
<pageSet><pageArea name="Page1" id="Page1"><contentArea x="0.5in" y="0.5in" w="7.5in" h="10in"/><medium stock="letter" short="8.5in" long="11in"/></pageArea></pageSet>
<subform name="body" w="7.5in" layout="tb">
<draw name="Title" w="7in" h="0.6in"><value><text>XFA Test Application</text></value><font size="18pt" typeface="Helvetica" weight="bold"/></draw>
<field name="FullName" w="5in" h="0.4in"><ui><textEdit/></ui><font size="11pt" typeface="Helvetica"/><caption reserve="1.4in"><value><text>Full name</text></value></caption><border><edge/></border></field>
<field name="City" w="5in" h="0.4in"><ui><textEdit/></ui><font size="11pt" typeface="Helvetica"/><caption reserve="1.4in"><value><text>City</text></value></caption><border><edge/></border></field>
<field name="Agree" w="3in" h="0.4in"><ui><checkButton/></ui><items><integer>1</integer><integer>0</integer></items><font size="11pt" typeface="Helvetica"/><caption reserve="1.4in"><value><text>I agree</text></value></caption></field>
</subform>
</subform>
</template>`;
const DATASETS = `<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><form1><body><FullName>Jane Prefilled</FullName><City/><Agree>0</Agree></body></form1></xfa:data></xfa:datasets>`;
const CONFIG = `<config xmlns="http://www.xfa.org/schema/xci/3.1/"><present><pdf><version>1.7</version><interactive>1</interactive></pdf></present></config>`;

export async function makeXfaPdf({ hybrid = false } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  // Same wording as Adobe's placeholder so tests prove we don't show it.
  if (hybrid) page.drawText("Static XFA application - Full name:", { x: 72, y: 590, size: 12, font });
  else {
  page.drawText("Please wait...", { x: 72, y: 700, size: 18, font });
  page.drawText("If this message is not eventually replaced by the proper contents of the document, your PDF", { x: 72, y: 670, size: 9, font });
  page.drawText("viewer may not be able to display this type of document.", { x: 72, y: 658, size: 9, font });
  }
  const ctx = pdf.context;
  const s = (txt) => ctx.register(ctx.flateStream(new TextEncoder().encode(txt)));
  const xfa = PDFArray.withContext(ctx);
  for (const [k, v] of [["preamble", '<?xml version="1.0" encoding="UTF-8"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">'], ["config", CONFIG], ["template", TEMPLATE], ["datasets", DATASETS], ["postamble", "</xdp:xdp>"]]) {
    xfa.push(PDFString.of(k)); xfa.push(s(v));
  }
  if (hybrid) {
    // Static-XFA style: real AcroForm widgets exist alongside XFA (pdf-lib creates the AcroForm dict).
    const form = pdf.getForm();
    form.createTextField("form1[0].body[0].FullName[0]").addToPage(page, { x: 72, y: 560, width: 300, height: 22 });
    form.updateFieldAppearances(font);
  }
  const acro = hybrid ? pdf.catalog.lookup(PDFName.of("AcroForm")) : ctx.obj({ Fields: [] });
  acro.set(PDFName.of("XFA"), xfa);
  if (!hybrid) { pdf.catalog.set(PDFName.of("AcroForm"), ctx.register(acro)); pdf.catalog.set(PDFName.of("NeedsRendering"), ctx.obj(true)); }
  // updateFieldAppearances:false — pdf-lib's default save calls getForm(), which deletes /XFA.
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}
