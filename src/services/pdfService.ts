import * as pdfjsLib from 'pdfjs-dist';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export type PdfExtractionErrorCode =
  | 'CORRUPT_PDF'
  | 'PASSWORD_PROTECTED_PDF'
  | 'IMAGE_ONLY_PDF';

export class PdfExtractionError extends Error {
  constructor(
    public readonly code: PdfExtractionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PdfExtractionError';
  }
}

export interface ExtractedPageData {
  pageNumber: number;
  text: string;
  characterCount: number;
  isEmpty: boolean;
  isVeryShort: boolean;
}

export interface PdfExtractionMetadata {
  totalPages: number;
  totalCharacterCount: number;
  averageCharactersPerPage: number;
  emptyPageCount: number;
  veryShortPageCount: number;
  extractionConfidence: number;
  lowQuality: boolean;
  likelyScanned: boolean;
}

export interface PdfExtractionResult {
  pagesText: string[];
  pages: ExtractedPageData[];
  metadata: PdfExtractionMetadata;
}

const VERY_SHORT_PAGE_THRESHOLD = 40;

function normalizePdfError(error: unknown): Error {
  if (error instanceof PdfExtractionError) {
    return error;
  }

  const name = (error as { name?: string })?.name;
  const message = (error as { message?: string })?.message ?? 'Unknown PDF extraction error.';

  if (name === 'PasswordException') {
    return new PdfExtractionError(
      'PASSWORD_PROTECTED_PDF',
      'This PDF is password-protected. Please unlock it and upload again.',
    );
  }

  if (
    name === 'InvalidPDFException' ||
    name === 'FormatError' ||
    name === 'MissingPDFException' ||
    /invalid|malformed|corrupt/i.test(message)
  ) {
    return new PdfExtractionError(
      'CORRUPT_PDF',
      'This PDF appears to be corrupt or unreadable. Please try another file.',
    );
  }

  return new Error(message);
}

function calculateExtractionConfidence(
  emptyPageRatio: number,
  veryShortPageRatio: number,
  averageCharactersPerPage: number,
): number {
  const averagePenalty = averageCharactersPerPage >= 120
    ? 0
    : (120 - averageCharactersPerPage) / 120;

  const rawScore = 1 - (emptyPageRatio * 0.55 + veryShortPageRatio * 0.3 + averagePenalty * 0.15);
  return Math.max(0, Math.min(1, rawScore));
}

export async function extractTextFromPdf(file: File): Promise<PdfExtractionResult> {
  const arrayBuffer = await file.arrayBuffer();

  let pdf: pdfjsLib.PDFDocumentProxy;

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdf = await loadingTask.promise;
  } catch (error) {
    throw normalizePdfError(error);
  }

  const pages: ExtractedPageData[] = [];

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      let pageText = '';
      let lastY = -1;

      for (const item of textContent.items as Array<{ str?: string; transform?: number[] }>) {
        const text = item.str ?? '';
        const y = item.transform?.[5] ?? lastY;

        if (lastY !== -1 && y !== -1 && Math.abs(y - lastY) > 5) {
          pageText += '\n';
        } else if (pageText.length > 0 && !pageText.endsWith(' ')) {
          pageText += ' ';
        }

        pageText += text;
        lastY = y;
      }

      const normalizedText = pageText.trim();
      const characterCount = normalizedText.length;

      pages.push({
        pageNumber: i,
        text: normalizedText,
        characterCount,
        isEmpty: characterCount === 0,
        isVeryShort: characterCount > 0 && characterCount < VERY_SHORT_PAGE_THRESHOLD,
      });
    }
  } catch (error) {
    throw normalizePdfError(error);
  }

  const totalPages = pages.length;
  const pagesText = pages.map((page) => page.text);
  const totalCharacterCount = pages.reduce((sum, page) => sum + page.characterCount, 0);
  const emptyPageCount = pages.filter((page) => page.isEmpty).length;
  const veryShortPageCount = pages.filter((page) => page.isVeryShort).length;
  const averageCharactersPerPage = totalPages > 0 ? totalCharacterCount / totalPages : 0;

  const emptyPageRatio = totalPages > 0 ? emptyPageCount / totalPages : 1;
  const veryShortPageRatio = totalPages > 0 ? veryShortPageCount / totalPages : 1;
  const extractionConfidence = calculateExtractionConfidence(
    emptyPageRatio,
    veryShortPageRatio,
    averageCharactersPerPage,
  );

  const lowQuality = emptyPageRatio >= 0.3 || (emptyPageRatio + veryShortPageRatio) >= 0.6;
  const likelyScanned = extractionConfidence < 0.35 || (emptyPageRatio >= 0.8 && totalCharacterCount < 100);

  if (totalCharacterCount === 0 || likelyScanned) {
    throw new PdfExtractionError(
      'IMAGE_ONLY_PDF',
      'This PDF appears to be image-only/scanned and has no extractable text. Please run OCR first.',
    );
  }

  return {
    pagesText,
    pages,
    metadata: {
      totalPages,
      totalCharacterCount,
      averageCharactersPerPage,
      emptyPageCount,
      veryShortPageCount,
      extractionConfidence,
      lowQuality,
      likelyScanned,
    },
  };
}
