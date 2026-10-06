/**
 * TypeScript type definitions for the PDF Layout Translator application.
 */

export interface PDFBlock {
  id: string;
  text: string;
  originalText: string;
  x: number; // Viewport-proportional x coordinate
  y: number; // Viewport-proportional y coordinate
  width: number; // Block layout width
  height: number; // Block layout height
  fontSize: number; // Approximate scaling font size
  fontName: string;
}

export interface ExtractedTerm {
  original: string;
  translated: string;
  explanation: string;
}

export interface PageTranslationData {
  pageNumber: number;
  translatedBlocks: Record<string, string>; // Maps PDFBlock.id to translated text
  extractedTerms: ExtractedTerm[];
  isLoading: boolean;
  error?: string;
}

export interface TranslationConfig {
  targetLanguage: string;
  terminologyMode: "translated-original-parentheses" | "original-translated-parentheses";
  domain: string;
  glossary: string[];
}
