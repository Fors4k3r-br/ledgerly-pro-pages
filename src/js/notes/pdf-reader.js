// Leitura e renderização de PDFs usando a biblioteca PDF.js já carregada pelo app.
// O módulo não interpreta notas de corretagem: essa responsabilidade permanece no parser.

export async function extractTextFromPDFBuffer(arrayBuffer) {
  const pdfjs = globalThis.pdfjsLib;
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
    throw new Error('Leitor de PDF indisponível.');
  }

  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    fullText += strings.join(' ') + '\n';
  }
  return fullText;
}

export async function renderPdfPages(container, bytes) {
  container.textContent = '';
  const pdfjs = globalThis.pdfjsLib;
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
    throw new Error('visualizador indisponível');
  }

  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const cw = Math.max(container.clientWidth, 280);
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (cw / base.width) * dpr });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas indisponível');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = 'w-full h-auto rounded-lg bg-white';
    container.appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
}

// Compatibilidade com os handlers clássicos do index.html.
globalThis.extractTextFromPDFBuffer = extractTextFromPDFBuffer;
globalThis.renderPdfPages = renderPdfPages;

// Ponte de compatibilidade: mantém os nomes públicos acessíveis ao HTML e aos demais módulos.
Object.defineProperty(globalThis, "extractTextFromPDFBuffer", { configurable: true, enumerable: true, get: () => extractTextFromPDFBuffer, set: value => { extractTextFromPDFBuffer = value; } });
Object.defineProperty(globalThis, "renderPdfPages", { configurable: true, enumerable: true, get: () => renderPdfPages, set: value => { renderPdfPages = value; } });
