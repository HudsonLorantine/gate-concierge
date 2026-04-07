import Tesseract from 'tesseract.js';
import { normalizePlate, isValidPlateFormat } from '../utils/plate';
import { logger } from '../utils/logger';

export interface OcrResult {
  raw_text: string;
  candidates: Array<{
    plate: string;
    confidence: number;
  }>;
  best_match: {
    plate: string;
    confidence: number;
  } | null;
}

/**
 * Extract plate number candidates from an image.
 * Uses Tesseract OCR with post-processing to find likely plate numbers.
 */
export async function extractPlateFromImage(imagePath: string): Promise<OcrResult> {
  logger.info(`OCR processing: ${imagePath}`);

  const { data } = await Tesseract.recognize(imagePath, 'eng', {
    // @ts-ignore - tesseract.js logger option
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        logger.debug(`OCR progress: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  const rawText = data.text;
  logger.debug(`OCR raw text: ${rawText}`);

  // Extract candidate plate numbers from OCR text
  const candidates: Array<{ plate: string; confidence: number }> = [];

  // Split text into words/tokens and try to find plate-like patterns
  const tokens = rawText.split(/[\s\n\r,;:]+/).filter(Boolean);

  for (const token of tokens) {
    const cleaned = normalizePlate(token);
    if (cleaned.length >= 3 && cleaned.length <= 10 && isValidPlateFormat(cleaned)) {
      candidates.push({
        plate: cleaned,
        confidence: data.confidence / 100,
      });
    }
  }

  // Also try combining adjacent tokens (plate might be split: "VEP 1234")
  for (let i = 0; i < tokens.length - 1; i++) {
    const combined = normalizePlate(tokens[i] + tokens[i + 1]);
    if (combined.length >= 3 && combined.length <= 10 && isValidPlateFormat(combined)) {
      candidates.push({
        plate: combined,
        confidence: (data.confidence / 100) * 0.9, // slightly lower confidence for combined
      });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = candidates.filter(c => {
    if (seen.has(c.plate)) return false;
    seen.add(c.plate);
    return true;
  });

  // Sort by confidence
  unique.sort((a, b) => b.confidence - a.confidence);

  const result: OcrResult = {
    raw_text: rawText,
    candidates: unique,
    best_match: unique.length > 0 ? unique[0] : null,
  };

  logger.info(`OCR result: ${unique.length} candidates found. Best: ${result.best_match?.plate || 'none'}`);
  return result;
}
