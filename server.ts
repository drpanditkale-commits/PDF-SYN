import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up JSON body parser with increased limit to support large PDF page text extractions
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

// Initialize Gemini client server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Translation API endpoint
app.post("/api/translate", async (req, res) => {
  try {
    const { blocks, targetLanguage, terminologyMode, domain, glossary } = req.body;

    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ error: "No text blocks provided for translation." });
    }

    if (!targetLanguage) {
      return res.status(400).json({ error: "No target language provided." });
    }

    const domainName = domain || "General";
    const mode = terminologyMode || "translated-original-parentheses";
    const customGlossary = glossary || [];

    // Prompt instructions for Gemini to preserve layout structure mapping and bilingual terms
    const glossaryInstruction = customGlossary.length > 0 
      ? `Always keep the absolute original spelling (un-translated) for the following exact user-defined glossary terms and do not alter them: [${customGlossary.join(", ")}].`
      : "";

    const userPrompt = `You are a high-fidelity billingual specialist and translation engine in the "${domainName}" domain.
Translate the following list of PDF text blocks into the target language: "${targetLanguage}".

CRITICAL REQUIREMENTS FOR TECHNICAL/BASIC TERMINOLOGY preservation:
1. Detect all technical keywords, specialized terms, key subjects, or domain-specific names (such as "Neural Networks", "Amortization", "DNA replication", "Subpoena", etc.).
2. You must render BOTH the translated term and the original source terms for these technical/basic terminologies according to these terminology modes:
   - If terminologyMode is "translated-original-parentheses": Translate the term into "${targetLanguage}" first, and append the original English/source term in parentheses immediately following the translated term. Example: "Redes neuronales (Neural Networks)" or "Apprentissage profond (Deep Learning)".
   - If terminologyMode is "original-translated-parentheses": Write the original English/source term first, and append its "${targetLanguage}" translation in parentheses. Example: "Neural Networks (Redes neuronales)" or "Deep Learning (Apprentissage profond)".
3. Translate all normal, standard prose, structural glue-words, transitions, prepositions, common adjectives, and verbs cleanly and naturally to "${targetLanguage}" without appending original terms.
4. Keep the exact letter casing styles (e.g. title-cased if the original was title-cased, or capitalized acronyms) where possible.
5. ${glossaryInstruction}

You must respond with a JSON object strictly matching this schema structure:
{
  "translatedBlocks": [
    { "id": "blockId", "text": "Translated text with preserved terminology" }
  ],
  "extractedTerms": [
    { "original": "Original Term", "translated": "Translated Term", "explanation": "A very brief, helpful definition of this term in ${targetLanguage}" }
  ]
}

Input Blocks to translate:
${JSON.stringify(blocks, null, 2)}`;

    // Invoke Gemini 3.5-flash for reliable translation + structured JSON parsing
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translatedBlocks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
                required: ["id", "text"],
              },
            },
            extractedTerms: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  original: { type: Type.STRING },
                  translated: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: ["original", "translated", "explanation"],
              },
            },
          },
          required: ["translatedBlocks", "extractedTerms"],
        },
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("Empty response received from translation engine.");
    }

    const parsedData = JSON.parse(responseText.trim());
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Translation server error:", error);
    return res.status(500).json({
      error: "Failed to translate page content with Gemini.",
      details: error.message || error,
    });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", time: new Date() });
});

// Configure Vite middleware or Static files build serving
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up active Vite development middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving production bundle from dist folder...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Bilingual PDF Layout Translator Server running on port ${PORT}`);
  });
}

setupServer();
