import { PDFBlock } from "./types";

// Configure web worker for PDF.js of the CDN
if (typeof window !== "undefined" && (window as any).pdfjsLib) {
  (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
}

/**
 * Loads a PDF document from a File or ArrayBuffer.
 */
export async function loadPDF(file: File): Promise<any> {
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("PDF.js library failed to load from CDN. Please refresh.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  return loadingTask.promise;
}

/**
 * Renders a PDF page to a canvas and returns its text runs grouped into blocks.
 */
export async function loadAndRenderPage(
  pdfDoc: any,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number = 1.5
): Promise<{ blocks: PDFBlock[]; width: number; height: number }> {
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("PDF.js library is not ready.");
  }

  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  // Size the canvas to match the PDF page size
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create canvas 2D context.");
  }

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // Clear canvas
  context.clearRect(0, 0, canvas.width, canvas.height);

  // Render the original PDF graphics & structure directly onto the canvas
  const renderContext = {
    canvasContext: context,
    viewport: viewport,
  };
  await page.render(renderContext).promise;

  // Now, extract raw text items to construct our absolute positioning blocks
  const textContent = await page.getTextContent();
  const rawItems = textContent.items;

  if (rawItems.length === 0) {
    return { blocks: [], width: viewport.width, height: viewport.height };
  }

  // Map raw text runs into working layout item representation
  const items = rawItems.map((item: any, idx: number) => {
    const transform = item.transform; // [scaleX, skewY, skewX, scaleY, x, y]
    const x = transform[4];
    const y = transform[5];

    // Project coordinates from PDF user space to viewport/canvas pixel space
    const [vx, vy] = viewport.convertToViewportPoint(x, y);

    // Font height is proportional to the vertical scale factor
    const fontSize = Math.abs(transform[0]);

    return {
      id: `raw-${idx}`,
      text: item.str,
      originalText: item.str,
      x: vx,
      y: vy - fontSize, // Align to top-left of bounding box
      width: item.width * scale,
      height: item.height * scale || fontSize * 1.2,
      fontSize: fontSize * scale,
      fontName: item.fontName,
      pdfY: y, // keep original PDF coordinates for sorting/grouping
      pdfX: x,
    };
  });

  // Group raw items into cohesive block paragraphs/lines based on geometric proximity
  // 1. Sort items from top-to-bottom (pdfY descending, since Y=0 starts at bottom)
  //    and left-to-right (pdfX ascending)
  items.sort((a: any, b: any) => {
    const yDiff = b.pdfY - a.pdfY;
    // If on roughly different vertical coordinates (difference > 4pt)
    if (Math.abs(yDiff) > 4) {
      return yDiff;
    }
    return a.pdfX - b.pdfX;
  });

  const mergedBlocks: PDFBlock[] = [];
  let currentBlock: any = null;

  for (const item of items) {
    // If item text is purely whitespace, ignore
    if (!item.text.trim()) continue;

    if (!currentBlock) {
      currentBlock = { ...item };
      continue;
    }

    // Determine geometric proximity to merge text into continuous lines
    const yDiff = Math.abs(currentBlock.pdfY - item.pdfY);
    const xDistance = item.pdfX - (currentBlock.pdfX + (currentBlock.width / scale));

    const isSameLine = yDiff <= 6; // Roughly same horizontal line
    const isNearby = xDistance < 45; // Word/phrase gap threshold

    if (isSameLine && isNearby) {
      // Merge items
      const spacer = xDistance > 2 ? " " : "";
      currentBlock.text += spacer + item.text;
      currentBlock.originalText += spacer + item.originalText;
      currentBlock.width = (item.x + item.width) - currentBlock.x;
      // Maximize heights / font sizes to prevent cutoff
      currentBlock.height = Math.max(currentBlock.height, item.height);
      currentBlock.fontSize = Math.max(currentBlock.fontSize, item.fontSize);
    } else {
      // Push completed current block and start a new one
      mergedBlocks.push({
        id: `block-${mergedBlocks.length}`,
        text: currentBlock.text,
        originalText: currentBlock.originalText,
        x: currentBlock.x,
        y: currentBlock.y,
        width: currentBlock.width,
        height: currentBlock.height,
        fontSize: currentBlock.fontSize,
        fontName: currentBlock.fontName,
      });
      currentBlock = { ...item };
    }
  }

  if (currentBlock) {
    mergedBlocks.push({
      id: `block-${mergedBlocks.length}`,
      text: currentBlock.text,
      originalText: currentBlock.originalText,
      x: currentBlock.x,
      y: currentBlock.y,
      width: currentBlock.width,
      height: currentBlock.height,
      fontSize: currentBlock.fontSize,
      fontName: currentBlock.fontName,
    });
  }

  return {
    blocks: mergedBlocks,
    width: viewport.width,
    height: viewport.height,
  };
}
