function escapePdfText(value) {
  return String(value ?? '').replace(/[\\()]/g, '\\$&').replace(/\r?\n/g, ' ');
}

function buildPdfBuffer({ title = 'Beam calculation report', lines = [] }) {
  const textLines = [title, '', ...lines].slice(0, 120);
  const content = [
    'BT',
    '/F1 14 Tf',
    '50 790 Td',
    ...textLines.flatMap((line, index) => [
      index === 0 ? '' : '0 -18 Td',
      `(${escapePdfText(line)}) Tj`
    ]).filter(Boolean),
    'ET'
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function resultToPdf(result, metadata = {}) {
  return buildPdfBuffer({
    title: metadata.calculationTitle || 'Beam calculation report',
    lines: [
      `Project: ${metadata.projectName || 'Untitled beam project'}`,
      `Job/reference: ${metadata.jobReference || '-'}`,
      `Revision: ${metadata.revision || '-'}`,
      `Engineer: ${metadata.engineerName || '-'}`,
      `Checked by: ${metadata.checkedBy || '-'}`,
      `Status: ${result.status}`,
      `Section: ${result.inputEcho.section.family} ${result.inputEcho.section.name}`,
      `Span: ${result.inputEcho.span} m`,
      `Governing IR: ${result.summary.governingIR}`,
      `Max moment: ${result.summary.maxMoment} ${result.summary.momentUnit}`,
      `Max shear: ${result.summary.maxShear} ${result.summary.forceUnit}`,
      `Deflection: ${result.summary.deflection} mm`,
      `Source: ${result.source.title}`
    ]
  });
}

module.exports = { resultToPdf };
