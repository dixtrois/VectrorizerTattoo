
export interface CurvePoint {
  x: number; // 0 to 255
  y: number; // 0 to 255
}

export type CurveChannel = 'all' | 'red';

export interface ProcessingSettings {
  levels: number;
  opacity: number;
  isBlackAndWhite: boolean;
  curves: {
    all: CurvePoint[];
    red: CurvePoint[];
  };
}

export interface ImageData {
  url: string;
  width: number;
  height: number;
  originalPixels: Uint8ClampedArray | null;
}
