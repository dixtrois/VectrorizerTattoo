
import { CurvePoint } from '../types';

/**
 * Coefficients de luminosité Rec. 709 (standard international).
 * Garantit que le passage en N&B respecte la perception humaine des valeurs.
 */
const LUMINANCE_R = 0.2126;
const LUMINANCE_G = 0.7152;
const LUMINANCE_B = 0.0722;

export const getCurveLUT = (points: CurvePoint[]): Uint8Array => {
  const lut = new Uint8Array(256);
  const sorted = [...points].sort((a, b) => a.x - b.x);
  for (let i = 0; i < 256; i++) {
    let p1 = sorted[0], p2 = sorted[sorted.length - 1];
    for (let j = 0; j < sorted.length - 1; j++) {
      if (i >= sorted[j].x && i <= sorted[j + 1].x) {
        p1 = sorted[j]; p2 = sorted[j + 1];
        break;
      }
    }
    if (p1.x === p2.x) lut[i] = p1.y;
    else {
      const t = (i - p1.x) / (p2.x - p1.x);
      lut[i] = Math.max(0, Math.min(255, Math.round(p1.y + t * (p2.y - p1.y))));
    }
  }
  return lut;
};

export const applyMultiChannelCurves = (
  pixels: Uint8ClampedArray, 
  luts: { all: Uint8Array, red: Uint8Array },
  target?: Uint8ClampedArray
): Uint8ClampedArray => {
  const res = target || new Uint8ClampedArray(pixels.length);
  const lutR = luts.red;
  const lutA = luts.all;
  for (let i = 0; i < pixels.length; i += 4) {
    res[i] = lutA[lutR[pixels[i]]];
    res[i + 1] = lutA[pixels[i+1]];
    res[i + 2] = lutA[pixels[i+2]];
    res[i + 3] = pixels[i + 3];
  }
  return res;
};

export interface KMeansResult {
  pixels: Uint8ClampedArray;
  centroids: number[][];
  labels: Int32Array;
}

export const runKMeans = (
  pixels: Uint8ClampedArray,
  k: number,
  isBlackAndWhite: boolean,
  quality: 'low' | 'high' = 'high'
): KMeansResult => {
  const pixelCount = pixels.length / 4;
  const sampleSize = quality === 'low' ? 4000 : 20000;
  const maxIterations = quality === 'low' ? 3 : 10;
  const step = Math.max(1, Math.floor(pixelCount / sampleSize));
  
  const data: number[][] = [];
  for (let i = 0; i < pixelCount; i += step) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    data.push(isBlackAndWhite ? [LUMINANCE_R * r + LUMINANCE_G * g + LUMINANCE_B * b] : [r, g, b]);
  }

  // INITIALISATION UNIFORME (Style Isolélie / Posterize)
  // On crée des niveaux répartis de façon égale sur 0-255 au lieu de prendre des points au hasard.
  let centroids: number[][] = [];
  for (let i = 0; i < k; i++) {
    const val = Math.round((255 / (k - 1)) * i);
    centroids.push(isBlackAndWhite ? [val] : [val, val, val]);
  }

  // BOUCLE D'OPTIMISATION (K-Means)
  for (let iter = 0; iter < maxIterations; iter++) {
    const sums: number[][] = Array.from({ length: k }, () => isBlackAndWhite ? [0] : [0,0,0]);
    const counts = new Int32Array(k);

    for (const point of data) {
      let minDist = Infinity, idx = 0;
      for (let j = 0; j < k; j++) {
        const d = euclideanDistanceSq(point, centroids[j]);
        if (d < minDist) { minDist = d; idx = j; }
      }
      counts[idx]++;
      for(let d=0; d<point.length; d++) sums[idx][d] += point[d];
    }
    
    centroids = centroids.map((c, i) => {
      // On verrouille le noir et le blanc s'ils ont été initialisés
      if (i === 0) return isBlackAndWhite ? [0] : [0,0,0];
      if (i === k - 1) return isBlackAndWhite ? [255] : [255,255,255];
      
      if (counts[i] === 0) return c;
      return sums[i].map(s => s / counts[i]);
    });
  }

  const labels = new Int32Array(pixelCount);
  const resultPixels = new Uint8ClampedArray(pixels.length);
  
  for (let i = 0; i < pixelCount; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    const lum = LUMINANCE_R * r + LUMINANCE_G * g + LUMINANCE_B * b;
    const p = isBlackAndWhite ? [lum] : [r, g, b];
    
    let minDist = Infinity, idx = 0;
    for (let j = 0; j < k; j++) {
      const d = euclideanDistanceSq(p, centroids[j]);
      if (d < minDist) { minDist = d; idx = j; }
    }
    
    labels[i] = idx;
    const c = centroids[idx];
    
    if (isBlackAndWhite) {
      const v = Math.round(c[0]);
      resultPixels[i*4] = resultPixels[i*4+1] = resultPixels[i*4+2] = v;
    } else {
      resultPixels[i*4] = Math.round(c[0]);
      resultPixels[i*4+1] = Math.round(c[1]);
      resultPixels[i*4+2] = Math.round(c[2]);
    }
    resultPixels[i*4+3] = pixels[i*4+3];
  }

  return { pixels: resultPixels, centroids, labels };
};

const euclideanDistanceSq = (a: number[], b: number[]): number => {
  let d = 0;
  for(let i=0; i<a.length; i++) d += (a[i]-b[i])**2;
  return d;
};

export const blendImages = (
  original: Uint8ClampedArray,
  processed: Uint8ClampedArray,
  opacity: number,
  isBlackAndWhite: boolean = false,
  target?: Uint8ClampedArray
): Uint8ClampedArray => {
  const res = target || new Uint8ClampedArray(original.length);
  const alpha = opacity / 100;
  const invAlpha = 1 - alpha;
  
  for (let i = 0; i < original.length; i += 4) {
    let r1 = original[i], g1 = original[i + 1], b1 = original[i + 2];
    if (isBlackAndWhite) {
      const gray = LUMINANCE_R * r1 + LUMINANCE_G * g1 + LUMINANCE_B * b1;
      r1 = g1 = b1 = gray;
    }
    res[i] = r1 * invAlpha + processed[i] * alpha;
    res[i + 1] = g1 * invAlpha + processed[i + 1] * alpha;
    res[i + 2] = b1 * invAlpha + processed[i + 2] * alpha;
    res[i + 3] = original[i + 3];
  }
  return res;
};
