import React, { useState, useRef, useEffect } from "react";
import { 
  Languages, 
  UploadCloud, 
  ChevronLeft, 
  ChevronRight, 
  Copy, 
  Check, 
  Sparkles, 
  Search, 
  BookOpen, 
  Columns, 
  Layers, 
  ZoomIn, 
  ZoomOut, 
  Info, 
  AlertCircle,
  Undo2,
  FileText,
  BadgeAlert,
  Settings,
  HelpCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PDFBlock, ExtractedTerm, PageTranslationData, TranslationConfig } from "./types";
import { loadPDF, loadAndRenderPage } from "./pdfParser";

export default function App() {
  // App state
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.25);
  const [viewMode, setViewMode] = useState<"split" | "overlay">("split");
  const [overlayOpacity, setOverlayOpacity] = useState<number>(100); // Overlay text box opacity

  // Raw extracted text blocks for the current page
  const [blocks, setBlocks] = useState<PDFBlock[]>([]);
  const [canvasWidth, setCanvasWidth] = useState<number>(0);
  const [canvasHeight, setCanvasHeight] = useState<number>(0);

  // Core Translation Config
  const [config, setConfig] = useState<TranslationConfig>({
    targetLanguage: "Spanish",
    terminologyMode: "translated-original-parentheses",
    domain: "Computer Science & AI",
    glossary: [],
  });

  // User input glossaries (state for formatting input)
  const [newGlossaryTerm, setNewGlossaryTerm] = useState<string>("");

  // Store translations cached per-page
  const [translationCache, setTranslationCache] = useState<Record<number, PageTranslationData>>({});
  
  // Hover states for terminology/sentence comparative display
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  // Terminology search filter
  const [termQuery, setTermQuery] = useState<string>("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [globalGlossary, setGlobalGlossary] = useState<ExtractedTerm[]>([]);

  // Page translation progress
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState<boolean>(false);

  // Canvas refs
  const canvasOriginalRef = useRef<HTMLCanvasElement | null>(null);
  const canvasTranslatedRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset states when uploading a new file
  const handleFileReset = () => {
    setFile(null);
    setPdfDoc(null);
    setNumPages(0);
    setCurrentPage(1);
    setBlocks([]);
    setTranslationCache({});
    setGlobalGlossary([]);
    setGlobalError(null);
    setSelectedBlockId(null);
    setHoveredBlockId(null);
  };

  // Process uploaded file
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === "application/pdf") {
      await processFile(selectedFile);
    }
  };

  const processFile = async (selectedFile: File) => {
    setPdfLoading(true);
    setGlobalError(null);
    try {
      setFile(selectedFile);
      const doc = await loadPDF(selectedFile);
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setCurrentPage(1);
      setTranslationCache({});
      setGlobalGlossary([]);
    } catch (err: any) {
      console.error(err);
      setGlobalError(err.message || "Failed to open and parse PDF document.");
      setFile(null);
    } finally {
      setPdfLoading(false);
    }
  };

  // Drag and drop event handlers
  const [isDragging, setIsDragging] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type === "application/pdf") {
      await processFile(droppedFile);
    } else {
      setGlobalError("Only PDF files are supported.");
    }
  };

  // Trigger page rendering and local layout block mapping
  useEffect(() => {
    if (!pdfDoc) return;

    let isSubscribed = true;

    async function renderAndGather() {
      try {
        setGlobalError(null);
        // Render Original Canvas always (used for coordinate background modeling)
        if (canvasOriginalRef.current) {
          const result = await loadAndRenderPage(
            pdfDoc,
            currentPage,
            canvasOriginalRef.current,
            scale
          );
          if (isSubscribed) {
            setBlocks(result.blocks);
            setCanvasWidth(result.width);
            setCanvasHeight(result.height);
          }
        }

        // Render Translated Canvas background if in split screen layout
        if (viewMode === "split" && canvasTranslatedRef.current) {
          await loadAndRenderPage(
            pdfDoc,
            currentPage,
            canvasTranslatedRef.current,
            scale
          );
        }
      } catch (err: any) {
        console.error("Rendering error:", err);
        if (isSubscribed) {
          setGlobalError(`Error parsing layout coordinates for page ${currentPage}: ` + err.message);
        }
      }
    }

    renderAndGather();

    return () => {
      isSubscribed = false;
    };
  }, [pdfDoc, currentPage, scale, viewMode]);

  // Translate current page blocks using Gemini standard 3.5-flash endpoint
  const translateCurrentPage = async () => {
    if (blocks.length === 0) return;
    setIsTranslating(true);
    setGlobalError(null);

    // Prepare translation list matching ID and content
    const translationPayload = blocks.map((b) => ({
      id: b.id,
      text: b.originalText,
    }));

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          blocks: translationPayload,
          targetLanguage: config.targetLanguage,
          terminologyMode: config.terminologyMode,
          domain: config.domain,
          glossary: config.glossary,
        }),
      });

      if (!response.ok) {
        const errDetail = await response.json();
        throw new Error(errDetail.error || "Server translation service failed.");
      }

      const result = await response.json();

      // Convert translated list list back to a mapping lookup record
      const blockMapping: Record<string, string> = {};
      result.translatedBlocks.forEach((item: any) => {
        blockMapping[item.id] = item.text;
      });

      // Cache the result to prevent double translating
      setTranslationCache((prev) => ({
        ...prev,
        [currentPage]: {
          pageNumber: currentPage,
          translatedBlocks: blockMapping,
          extractedTerms: result.extractedTerms,
          isLoading: false,
        },
      }));

      // Append extracted terms to cumulative dictionary log
      const uniqueNewTerms = result.extractedTerms.filter((fresh: ExtractedTerm) => 
        !globalGlossary.some((g) => g.original.toLowerCase() === fresh.original.toLowerCase())
      );
      setGlobalGlossary((prev) => [...prev, ...uniqueNewTerms]);

    } catch (err: any) {
      console.error(err);
      setGlobalError(err.message || "An unexpected error occurred during translation.");
    } finally {
      setIsTranslating(false);
    }
  };

  // Quick helper to get translation for a specific block id
  const getBlockTranslation = (blockId: string): string | null => {
    const pageCache = translationCache[currentPage];
    if (pageCache && pageCache.translatedBlocks[blockId]) {
      return pageCache.translatedBlocks[blockId];
    }
    return null;
  };

  // Add custom user override glossary tag
  const addGlossaryTag = () => {
    const cleaned = newGlossaryTerm.trim();
    if (cleaned && !config.glossary.includes(cleaned)) {
      setConfig((prev) => ({
        ...prev,
        glossary: [...prev.glossary, cleaned],
      }));
      setNewGlossaryTerm("");
    }
  };

  const removeGlossaryTag = (term: string) => {
    setConfig((prev) => ({
      ...prev,
      glossary: prev.glossary.filter((g) => g !== term),
    }));
  };

  // Copy terminology to clipboard helper
  const handleCopyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Filter terms by search input query
  const filteredTerms = globalGlossary.filter(
    (item) =>
      item.original.toLowerCase().includes(termQuery.toLowerCase()) ||
      item.translated.toLowerCase().includes(termQuery.toLowerCase()) ||
      item.explanation.toLowerCase().includes(termQuery.toLowerCase())
  );

  const currentPageCache = translationCache[currentPage];
  const isPageTranslated = !!currentPageCache;

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans" id="pdflayout_root">
      
      {/* 1. HEADER SECTION (ARCHITECTURAL DIGNITY) */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 py-4 flex items-center justify-between z-40 sticky top-0" id="header_section">
        <div className="flex items-center space-x-3">
          <div className="bg-blue-600 p-2 rounded-lg text-white shadow-lg animate-pulse" id="header_logo">
            <Languages className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
              Bilingual PDF Layout Translator
              <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded border border-blue-500/30">
                AI Engine
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Preserve original coordinates, visual layout structures, and precise scientific terminologies.
            </p>
          </div>
        </div>

        {file && (
          <div className="flex items-center space-x-3 bg-slate-800/80 px-4 py-2 rounded-lg border border-slate-700" id="active_file_info">
            <FileText className="w-4 h-4 text-blue-400" />
            <div className="text-right">
              <p className="text-xs font-semibold max-w-[200px] truncate">{file.name}</p>
              <p className="text-[10px] text-slate-400">{(file.size / (1024 * 1024)).toFixed(2)} MB • {numPages} Pages</p>
            </div>
            <button 
              onClick={handleFileReset}
              className="text-xs text-rose-400 hover:text-rose-300 ml-2 hover:bg-rose-500/10 p-1.5 rounded transition-colors"
              title="Upload new file"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* 2. MAIN BENTO GRID CANVAS VIEW */}
      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12 overflow-hidden h-[calc(100vh-73px)]" id="main_bento">
        
        {/* SIDEBAR: Configuration & Custom Settings (4/12 Grid) */}
        <section className="xl:col-span-3 border-r border-slate-800 bg-slate-900/60 p-5 overflow-y-auto flex flex-col justify-between" id="sidebar_configuration">
          <div className="space-y-6">
            
            {/* File Upload Slot if empty */}
            {!file ? (
              <div id="file_drag_card">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Upload Document</h3>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                    isDragging 
                      ? "border-blue-500 bg-blue-500/10" 
                      : "border-slate-800 hover:border-slate-700 bg-slate-900/40"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={onFileChange}
                    accept="application/pdf"
                    className="hidden"
                  />
                  {pdfLoading ? (
                    <div className="py-4 flex flex-col items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
                      <p className="text-sm text-slate-300">Parsing PDF metadata...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center space-y-3">
                      <div className="bg-slate-800 p-4 rounded-full text-slate-400 shadow-inner group-hover:scale-110 transition-transform">
                        <UploadCloud className="w-10 h-10 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">Click or Drag & Drop PDF</p>
                        <p className="text-xs text-slate-400 mt-1">High-fidelity layout mapping</p>
                      </div>
                    </div>
                  )}
                </div>
                {globalError && (
                  <div className="mt-4 p-3 bg-rose-500/10 text-rose-400 rounded-lg border border-rose-500/20 text-xs flex items-start gap-2">
                    <BadgeAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{globalError}</span>
                  </div>
                )}
              </div>
            ) : (
              // Active Document Settings pane
              <div className="space-y-5" id="active_settings_panel">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Settings className="w-3.5 h-3.5 text-blue-400" />
                     Translation Spec
                  </h3>
                </div>

                {/* Target Language Select */}
                <div className="space-y-2">
                  <label className="text-xs text-slate-300 block">Target Language</label>
                  <div className="relative">
                    <select
                      value={config.targetLanguage}
                      onChange={(e) => setConfig((prev) => ({ ...prev, targetLanguage: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none"
                    >
                      {["Spanish", "French", "German", "Italian", "Portuguese", "Japanese", "Chinese (Simplified)", "Chinese (Traditional)", "Hindi", "Arabic", "Korean", "Russian", "Dutch", "Swedish", "Turkish", "Vietnamese"].map((lang) => (
                        <option key={lang} value={lang}>{lang}</option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                      ▼
                    </div>
                  </div>
                </div>

                {/* Industry Domain Select */}
                <div className="space-y-2">
                  <label className="text-xs text-slate-300 block">Industry Terminology Domain</label>
                  <div className="relative">
                    <select
                      value={config.domain}
                      onChange={(e) => setConfig((prev) => ({ ...prev, domain: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 text-sm rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none"
                    >
                      {["General / Conversational", "Computer Science & AI", "Medical & Clinical Tech", "Legal & Regulatory Contracts", "Finance, Banking & Accounting", "Mechanical & Electrical Engineering", "Chemistry & Biotechnology", "Humanities & Social Studies"].map((dom) => (
                        <option key={dom} value={dom}>{dom}</option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                      ▼
                    </div>
                  </div>
                </div>

                {/* Terminology Representation Mode Selector */}
                <div className="space-y-2">
                  <label className="text-xs text-slate-300 block">Bilingual Format Mode</label>
                  <div className="grid grid-cols-1 gap-2">
                    <label className={`flex items-start p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      config.terminologyMode === "translated-original-parentheses"
                        ? "bg-blue-600/10 border-blue-500/60"
                        : "bg-slate-800/40 border-slate-800 hover:bg-slate-800/80"
                    }`}>
                      <input
                        type="radio"
                        name="termMode"
                        checked={config.terminologyMode === "translated-original-parentheses"}
                        onChange={() => setConfig((prev) => ({ ...prev, terminologyMode: "translated-original-parentheses" }))}
                        className="mt-0.5 mr-2 scale-100"
                      />
                      <div>
                        <span className="font-medium text-white block">Translated (Original)</span>
                        <span className="text-slate-400 text-[10px]">Apprêt profond (Deep learning)</span>
                      </div>
                    </label>

                    <label className={`flex items-start p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      config.terminologyMode === "original-translated-parentheses"
                        ? "bg-blue-600/10 border-blue-500/60"
                        : "bg-slate-800/40 border-slate-800 hover:bg-slate-800/80"
                    }`}>
                      <input
                        type="radio"
                        name="termMode"
                        checked={config.terminologyMode === "original-translated-parentheses"}
                        onChange={() => setConfig((prev) => ({ ...prev, terminologyMode: "original-translated-parentheses" }))}
                        className="mt-0.5 mr-2 scale-100"
                      />
                      <div>
                        <span className="font-medium text-white block">Original (Translated)</span>
                        <span className="text-slate-400 text-[10px]">Deep learning (Apprêt profond)</span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Custom User Glossary Tag Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-300 block">Custom Glossary Overrides</label>
                    <span className="text-[10px] text-slate-400">(Keep strictly original)</span>
                  </div>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={newGlossaryTerm}
                      onChange={(e) => setNewGlossaryTerm(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addGlossaryTag()}
                      placeholder="e.g. PyTorch"
                      className="flex-1 bg-slate-800 text-xs text-white rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={addGlossaryTag}
                      className="bg-slate-800 hover:bg-slate-700 text-xs px-2.5 py-1.5 text-slate-200 rounded-lg border border-slate-700"
                    >
                      Add
                    </button>
                  </div>

                  {config.glossary.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 max-h-24 overflow-y-auto">
                      {config.glossary.map((term) => (
                        <span
                          key={term}
                          className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700 flex items-center gap-1 group hover:border-rose-500"
                        >
                          {term}
                          <button
                            onClick={() => removeGlossaryTag(term)}
                            className="text-slate-500 hover:text-rose-400 font-bold ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Global Errors and Instructions details */}
            {file && globalError && (
              <div className="p-3 bg-rose-500/10 text-rose-400 rounded-xl border border-rose-500/20 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{globalError}</span>
              </div>
            )}

            {/* Quick Helper Tips */}
            {file && (
              <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                <h4 className="flex items-center gap-1.5 text-slate-300 font-semibold uppercase text-[10px] tracking-wider">
                  <Info className="w-3.5 h-3.5 text-blue-400" />
                  Bilingual Preservation Tip:
                </h4>
                <p className="text-slate-400 leading-relaxed">
                  Hover over translated text boxes to inspect the side-by-side comparative viewport and read dictionary explanations.
                </p>
              </div>
            )}
          </div>

          {/* Core Action Trigger Slot (Stays at the bottom) */}
          {file && (
            <div className="pt-4 border-t border-slate-800 space-y-3 bg-slate-950/20">
              <button
                onClick={translateCurrentPage}
                disabled={isTranslating}
                className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-center space-x-2 shadow-lg transition-transform hover:scale-[1.01] ${
                  isTranslating 
                    ? "bg-slate-850 text-slate-400 cursor-not-allowed border border-slate-800" 
                    : isPageTranslated 
                    ? "bg-slate-800 hover:bg-slate-700 text-blue-400 border border-slate-700"
                    : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white"
                }`}
              >
                {isTranslating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-400 mr-2"></div>
                    <span>Translating via Gemini...</span>
                  </>
                ) : isPageTranslated ? (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Re-Translate Current Page</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Translate Page {currentPage}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </section>

        {/* CENTER VIEW: Side-by-Side Dual-Lens PDF Layout Engine Grid (6/12 Grid) */}
        <section className="xl:col-span-6 bg-slate-950 flex flex-col justify-between overflow-hidden border-r border-slate-850" id="pdf_rendering_engine">
          
          {/* Controls Bar */}
          <div className="bg-slate-900/60 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between z-10" id="viewport_toolbar">
            
            {/* View Mode Select */}
            <div className="flex bg-slate-800 rounded-lg p-0.5 border border-slate-700 text-xs">
              <button
                onClick={() => setViewMode("split")}
                className={`px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition-all ${
                  viewMode === "split" 
                    ? "bg-blue-600 text-white shadow-sm" 
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Columns className="w-3.5 h-3.5" />
                Comparative Split
              </button>
              <button
                onClick={() => setViewMode("overlay")}
                className={`px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition-all ${
                  viewMode === "overlay" 
                    ? "bg-blue-600 text-white shadow-sm" 
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Aesthetic Overlay
              </button>
            </div>

            {/* Stepper Navigation */}
            {file && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage((c) => Math.max(1, c - 1))}
                  disabled={currentPage <= 1 || isTranslating}
                  className="bg-slate-800 hover:bg-slate-700 text-white p-1.5 rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono text-slate-300">
                  Page <span className="text-white font-bold">{currentPage}</span> of{" "}
                  <span className="text-slate-400">{numPages}</span>
                </span>
                <button
                  onClick={() => setCurrentPage((c) => Math.min(numPages, c + 1))}
                  disabled={currentPage >= numPages || isTranslating}
                  className="bg-slate-800 hover:bg-slate-700 text-white p-1.5 rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Zoom / Scale Toolbar */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setScale((s) => Math.max(0.75, s - 0.25))}
                disabled={scale <= 0.75}
                className="bg-slate-800 hover:bg-slate-700 text-white p-1.5 rounded-lg disabled:opacity-30 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono text-slate-300 min-w-[36px] text-center">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={() => setScale((s) => Math.min(2.5, s + 0.25))}
                disabled={scale >= 2.5}
                className="bg-slate-800 hover:bg-slate-700 text-white p-1.5 rounded-lg disabled:opacity-30 transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Interactive Layering Document Canvas Stage */}
          <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-start relative max-h-[calc(100vh-125px)]" id="canvas_stage">
            {!file ? (
              // Initial empty state illustration
              <div className="my-auto py-20 text-center max-w-sm flex flex-col items-center space-y-4">
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl animate-bounce text-slate-600 shadow-xl">
                  <Languages className="w-16 h-16 text-blue-500/80" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">No PDF Uploaded</h3>
                  <p className="text-xs text-slate-400 mt-1 lines-normal">
                    Upload any PDF document from the custom dashboard on the left-side panel to initiate translation.
                  </p>
                </div>
              </div>
            ) : (
              // Active dual-view/comparative viewport container
              <div 
                className={`grid gap-6 ${viewMode === "split" ? "grid-cols-1 md:grid-cols-2 max-w-7xl w-full" : "max-w-3xl w-full justify-center"}`}
                id="active_canvas_container"
              >
                {/* 1. ORIGINAL DOCUMENT BLOCK OR BLANK COVER IN COMPONENT */}
                <div 
                  className={`flex flex-col items-center relative ${viewMode === "overlay" ? "hidden" : ""}`}
                  style={{ width: canvasWidth ? `${canvasWidth}px` : "auto" }}
                >
                  <p className="text-[10px] font-mono text-slate-400 mb-2 uppercase tracking-wider">Original Source Context</p>
                  <div className="relative border border-slate-800 rounded-lg shadow-2xl bg-white overflow-hidden">
                    <canvas ref={canvasOriginalRef} className="block shadow-md max-w-full" />
                    
                    {/* Synchronized Hover Overlay Blocks for Original document visual guidance */}
                    <div className="absolute inset-0 pointer-events-none">
                      {blocks.map((block) => (
                        <div
                          key={`orig-${block.id}`}
                          className={`absolute border border-transparent transition-all ${
                            hoveredBlockId === block.id 
                              ? "bg-blue-500/10 border-blue-400/40" 
                              : selectedBlockId === block.id
                              ? "bg-indigo-500/20 border-indigo-400/50"
                              : ""
                          }`}
                          style={{
                            left: `${block.x}px`,
                            top: `${block.y}px`,
                            width: `${block.width}px`,
                            height: `${block.height}px`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* 2. TRANSLATED DOCUMENT CANVAS BLOCK WITH ABSOLUTE COORDINATE WRAPPERS */}
                <div 
                  className="flex flex-col items-center relative"
                  style={{ width: canvasWidth ? `${canvasWidth}px` : "auto" }}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      Translated Context Layout
                    </p>
                    {viewMode === "overlay" && (
                      <div className="flex items-center space-x-2 text-xs">
                        <span className="text-[10px] text-slate-400">Mask:</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={overlayOpacity}
                          onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                          className="w-16 accent-blue-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
                        />
                        <span className="font-mono text-slate-400 text-[10px]">{overlayOpacity}%</span>
                      </div>
                    )}
                  </div>

                  <div className="relative border border-slate-800 rounded-lg shadow-2xl bg-white overflow-hidden">
                    {/* Render original background canvas inside overlay/split wrapper */}
                    <canvas 
                      ref={viewMode === "overlay" ? canvasOriginalRef : canvasTranslatedRef} 
                      className="block shadow-md max-w-full" 
                    />

                    {/* ABSOLUTE METRIC OVERLAYS PANEL */}
                    <div 
                      className="absolute inset-0 z-1 pointer-events-auto"
                      style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
                    >
                      {/* Interactive block overlay items */}
                      {blocks.map((block) => {
                        const translatedText = getBlockTranslation(block.id);
                        const isHovered = hoveredBlockId === block.id;
                        const isSelected = selectedBlockId === block.id;

                        return (
                          <div
                            key={`trans-${block.id}`}
                            className={`absolute select-none overflow-hidden hover:overflow-visible transition-all flex items-center leading-normal text-slate-900 border ${
                              isHovered 
                                ? "bg-white border-blue-500 shadow-lg scale-[1.01] z-25 cursor-help" 
                                : isSelected 
                                ? "bg-indigo-50 border-indigo-500 shadow-md scale-100 z-10"
                                : "border-transparent"
                            }`}
                            style={{
                              left: `${block.x}px`,
                              top: `${block.y}px`,
                              width: `${block.width}px`,
                              height: `${block.height}px`,
                              // Approximate custom matching font style scaling dynamically
                              fontSize: `${block.fontSize}px`,
                              fontFamily: block.fontName.includes("Mono") ? "monospace" : "sans-serif",
                            }}
                            onMouseEnter={() => setHoveredBlockId(block.id)}
                            onMouseLeave={() => setHoveredBlockId(null)}
                            onClick={() => setSelectedBlockId(block.id)}
                          >
                            {/* Mask overlay backgrounds matching canvas context spacing to hide native original text */}
                            {translatedText ? (
                              <div 
                                className="w-full h-full p-0.5 z-2"
                                style={{
                                  backgroundColor: `rgba(255, 255, 255, ${overlayOpacity / 100})`,
                                  backdropFilter: overlayOpacity > 80 ? "blur(2px)" : "none",
                                }}
                              >
                                <span className="font-medium tracking-wide">
                                  {translatedText}
                                </span>
                              </div>
                            ) : (
                              // Original placeholders highlighting loading progress
                              <div className="w-full h-full bg-slate-300/10 cursor-help" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Comparison Tooltip Bar (Displays hover comparison results at the lower border pane of center grid) */}
          <div className="bg-slate-900 border-t border-slate-800 p-4 shrink-0 transition-all z-20" id="comparative_lens_bar">
            {hoveredBlockId && getBlockTranslation(hoveredBlockId) ? (
              <div className="flex items-start space-x-3 text-xs" id="comparative_lens_active">
                <div className="bg-blue-500/20 p-2 rounded text-blue-400">
                  <Languages className="w-4 h-4" />
                </div>
                <div className="flex-1 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Original Source</p>
                    <p className="text-slate-300 mt-1">{blocks.find(b => b.id === hoveredBlockId)?.originalText}</p>
                  </div>
                  <div className="border-l border-slate-800 pl-4">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-blue-400">Gemini Translated Terminology Context</p>
                    <p className="text-white mt-1 font-semibold">{getBlockTranslation(hoveredBlockId)}</p>
                  </div>
                </div>
              </div>
            ) : hoveredBlockId ? (
              <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5 py-1">
                <Info className="w-4 h-4 text-slate-500 animate-spin" />
                This block is ready to translate. Press "Translate Page" on the sidebar config.
              </p>
            ) : (
              <p className="text-xs text-slate-400 text-center py-1">
                Pro-Tip: Hover over any translated text block on the layout to inspect comparative text strings.
              </p>
            )}
          </div>
        </section>

        {/* RIGHT PANEL: Extracted Technical Glossaries & Dictionary Logs (3/12 Grid) */}
        <section className="xl:col-span-3 border-l border-slate-800 bg-slate-900/60 p-5 flex flex-col overflow-hidden h-full justify-between" id="glossary_panel">
          <div className="space-y-4 flex-1 flex flex-col overflow-hidden">
            
            {/* Header section of dashboard */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                Dynamic Glossary ({filteredTerms.length})
              </h3>
            </div>

            {/* Term search filter bar */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 pointers-events-none">
                <Search className="w-3.5 h-3.5" />
              </span>
              <input
                type="text"
                value={termQuery}
                onChange={(e) => setTermQuery(e.target.value)}
                placeholder="Search extracted terminologies..."
                className="w-full bg-slate-800/80 text-xs rounded-lg pl-8 pr-4 py-2 text-white border border-slate-700/80 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Structured Dictionary Log Viewport */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1" id="glossary_list_container">
              {filteredTerms.length === 0 ? (
                <div className="text-center py-12 text-slate-500 flex flex-col items-center justify-center space-y-3 border border-dashed border-slate-800 rounded-xl p-6 bg-slate-950/20">
                  <BookOpen className="w-10 h-10 text-slate-700" />
                  <div>
                    <h5 className="text-xs font-semibold text-slate-400">No jargon extracted yet</h5>
                    <p className="text-[10px] text-slate-500 mt-1 opacity-70">
                      Translated technical terminologies will automatically stream here.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredTerms.map((term, idx) => (
                    <div 
                      key={`${term.original}-${idx}`}
                      className="bg-slate-900 border border-slate-800 p-3 rounded-xl space-y-1.5 relative group hover:border-blue-500/40 transition-all hover:bg-slate-800/30"
                    >
                      <button
                        onClick={() => handleCopyToClipboard(`${term.original} = ${term.translated}`, idx)}
                        className="absolute top-2 right-2 p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded"
                        title="Copy to clipboard"
                      >
                        {copiedIndex === idx ? (
                          <Check className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <div className="flex flex-wrap items-center gap-1.5 pr-6">
                        <span className="text-xs font-bold text-white leading-tight">
                          {term.original}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">→</span>
                        <span className="text-xs text-blue-400 font-bold leading-tight">
                          {term.translated}
                        </span>
                      </div>

                      {term.explanation && (
                        <p className="text-[11px] text-slate-400 leading-relaxed pt-1.5 border-t border-slate-800/60 font-sans italic">
                          "{term.explanation}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Export Glossary capability at panel footer bounds */}
          {globalGlossary.length > 0 && (
            <div className="pt-4 border-t border-slate-850 mt-4">
              <button
                onClick={() => {
                  const csvHeaders = "Original,Translated,Definition\n";
                  const csvContent = globalGlossary.map(
                    (t) => `"${t.original.replace(/"/g, '""')}","${t.translated.replace(/"/g, '""')}","${t.explanation.replace(/"/g, '""')}"`
                  ).join("\n");
                  const blob = new Blob([csvHeaders + csvContent], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.setAttribute("href", url);
                  link.setAttribute("download", `Glossary_Bilingual_PDF.csv`);
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="w-full bg-slate-800 hover:bg-slate-700 text-xs py-2 rounded-lg font-medium text-slate-200 border border-slate-705 flex items-center justify-center gap-1.5 transition-colors"
              >
                Export CSV Glossary ({globalGlossary.length})
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
