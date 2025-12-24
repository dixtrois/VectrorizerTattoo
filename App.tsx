
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, Layers, Droplet, Contrast, Download, Trash2, Settings, 
  Image as ImageIcon, Loader2, Activity, Columns, Square 
} from 'lucide-react';
import { ProcessingSettings, ImageData, CurvePoint, CurveChannel } from './types';
import { runKMeans, blendImages, applyMultiChannelCurves, getCurveLUT, KMeansResult } from './utils/imageProcessing';

const App: React.FC = () => {
  const [image, setImage] = useState<ImageData | null>(null);
  const [activeChannel, setActiveChannel] = useState<CurveChannel>('red');
  const [isSplitMode, setIsSplitMode] = useState(true);
  const [splitPos, setSplitPos] = useState(50);
  
  const [settings, setSettings] = useState<ProcessingSettings>({
    levels: 10,
    opacity: 50,
    isBlackAndWhite: false,
    curves: {
      all: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      red: [{ x: 0, y: 0 }, { x: 60, y: 10 }, { x: 180, y: 245 }, { x: 255, y: 255 }],
    }
  });

  const [localCurves, setLocalCurves] = useState(settings.curves);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [curvedOnlyUrl, setCurvedOnlyUrl] = useState<string | null>(null);
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  
  const offscreenCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const lastKMeansResult = useRef<KMeansResult | null>(null);
  const requestRef = useRef<number>(0);
  const splitRef = useRef<HTMLDivElement>(null);
  const curveRef = useRef<SVGSVGElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = offscreenCanvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        const maxDim = 1000;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = (maxDim / w) * h; w = maxDim; }
          else { w = (maxDim / h) * w; h = maxDim; }
        }
        canvas.width = w; canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        setImage({
          url: event.target?.result as string,
          width: w, h,
          originalPixels: ctx.getImageData(0, 0, w, h).data
        });
        lastKMeansResult.current = null;
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const updateDisplay = useCallback(() => {
    if (!image || !image.originalPixels) return;

    const curvesToUse = isInteracting ? localCurves : settings.curves;
    const luts = {
      all: getCurveLUT(curvesToUse.all),
      red: getCurveLUT(curvesToUse.red),
    };

    const curvedPixels = applyMultiChannelCurves(image.originalPixels, luts);
    
    let finalPixels: Uint8ClampedArray;
    
    if (lastKMeansResult.current && isInteracting) {
      const { labels, centroids } = lastKMeansResult.current;
      const k = centroids.length;
      
      const newCentroids = Array.from({ length: k }, () => [0, 0, 0, 0]);
      for (let i = 0; i < labels.length; i++) {
        const idx = labels[i];
        const r = curvedPixels[i*4], g = curvedPixels[i*4+1], b = curvedPixels[i*4+2];
        if (settings.isBlackAndWhite) {
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          newCentroids[idx][0] += lum;
          newCentroids[idx][1] += lum;
          newCentroids[idx][2] += lum;
        } else {
          newCentroids[idx][0] += r;
          newCentroids[idx][1] += g;
          newCentroids[idx][2] += b;
        }
        newCentroids[idx][3]++;
      }

      const updatedCentroids = newCentroids.map(c => c[3] > 0 ? [c[0]/c[3], c[1]/c[3], c[2]/c[3]] : [255,255,255]);
      
      const fastPixels = new Uint8ClampedArray(curvedPixels.length);
      for (let i = 0; i < labels.length; i++) {
        const c = updatedCentroids[labels[i]];
        fastPixels[i*4] = c[0]; fastPixels[i*4+1] = c[1]; fastPixels[i*4+2] = c[2]; fastPixels[i*4+3] = 255;
      }
      finalPixels = blendImages(curvedPixels, fastPixels, settings.opacity, settings.isBlackAndWhite);
    } else {
      const res = runKMeans(curvedPixels, settings.levels, settings.isBlackAndWhite, isInteracting ? 'low' : 'high');
      lastKMeansResult.current = res;
      finalPixels = blendImages(curvedPixels, res.pixels, settings.opacity, settings.isBlackAndWhite);
    }

    const canvas = offscreenCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Pour le mode preview "curved only", on respecte aussi le N&B si actif
      const previewPixels = new Uint8ClampedArray(curvedPixels.length);
      for(let i=0; i<curvedPixels.length; i+=4) {
        if(settings.isBlackAndWhite) {
          const gray = 0.2126 * curvedPixels[i] + 0.7152 * curvedPixels[i+1] + 0.0722 * curvedPixels[i+2];
          previewPixels[i] = previewPixels[i+1] = previewPixels[i+2] = gray;
        } else {
          previewPixels[i] = curvedPixels[i]; previewPixels[i+1] = curvedPixels[i+1]; previewPixels[i+2] = curvedPixels[i+2];
        }
        previewPixels[i+3] = 255;
      }

      ctx.putImageData(new ImageData(previewPixels, image.width, image.height), 0, 0);
      setCurvedOnlyUrl(canvas.toDataURL('image/jpeg', 0.8));
      ctx.putImageData(new ImageData(finalPixels, image.width, image.height), 0, 0);
      setProcessedUrl(canvas.toDataURL('image/png'));
    }
  }, [image, settings, localCurves, isInteracting]);

  useEffect(() => {
    if (image) {
      if (isInteracting) {
        requestRef.current = requestAnimationFrame(updateDisplay);
      } else {
        setIsProcessing(true);
        const timer = setTimeout(() => {
          updateDisplay();
          setIsProcessing(false);
        }, 10);
        return () => clearTimeout(timer);
      }
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [image, settings.levels, settings.opacity, settings.isBlackAndWhite, settings.curves, localCurves, isInteracting, updateDisplay]);

  const handleCurveInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    if (!curveRef.current) return;
    const rect = curveRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = Math.max(0, Math.min(255, Math.round(((clientX - rect.left) / rect.width) * 255)));
    const y = Math.max(0, Math.min(255, Math.round((1 - (clientY - rect.top) / rect.height) * 255)));

    if (e.type === 'mousedown' || e.type === 'touchstart') {
      setIsInteracting(true);
      const pts = localCurves[activeChannel];
      const idx = pts.findIndex(p => Math.abs(p.x - x) < 15 && Math.abs(p.y - y) < 15);
      if (idx !== -1) setDraggingPointIndex(idx);
      else {
        const newPts = [...pts, { x, y }].sort((a, b) => a.x - b.x);
        setLocalCurves(prev => ({ ...prev, [activeChannel]: newPts }));
        setDraggingPointIndex(newPts.findIndex(p => p.x === x && p.y === y));
      }
    } else if ((e.type === 'mousemove' || e.type === 'touchmove') && draggingPointIndex !== null) {
      const pts = [...localCurves[activeChannel]];
      if (draggingPointIndex === 0) pts[draggingPointIndex] = { x: 0, y };
      else if (draggingPointIndex === pts.length - 1) pts[draggingPointIndex] = { x: 255, y };
      else pts[draggingPointIndex] = { x, y };
      setLocalCurves(prev => ({ ...prev, [activeChannel]: pts.sort((a,b) => a.x-b.x) }));
    }
  };

  const endInteraction = () => {
    if (!isInteracting) return;
    setDraggingPointIndex(null);
    setIsInteracting(false);
    setSettings(prev => ({ ...prev, curves: localCurves }));
    lastKMeansResult.current = null;
  };

  const handleDownload = () => {
    if (!processedUrl) return;
    const link = document.createElement('a');
    link.download = `tattookonex-isolélie-${Date.now()}.png`;
    link.href = processedUrl;
    link.click();
  };

  const handleSplitDrag = (e: React.MouseEvent | React.TouchEvent) => {
    if (!splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    setSplitPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#0a0a0a] select-none touch-none" 
         onMouseUp={endInteraction} onMouseLeave={endInteraction} onTouchEnd={endInteraction}>
      
      <aside className="w-full md:w-80 bg-[#121212] border-r border-[#262626] p-6 flex flex-col gap-6 z-20 overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white text-black rounded-lg"><Layers size={24} /></div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter text-white leading-none">TATTOOKONEX</h1>
            <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest mt-1">Real-time Studio v1.6</p>
          </div>
        </div>

        <section>
          {!image ? (
            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-[#262626] rounded-xl cursor-pointer hover:bg-[#1a1a1a] transition-all group">
              <Upload className="text-zinc-500 mb-1 group-hover:text-white" size={20} />
              <span className="text-xs text-zinc-400">Importer Photo</span>
              <input type="file" className="hidden" accept="image/*" onChange={handleUpload} />
            </label>
          ) : (
            <div className="relative group rounded-xl overflow-hidden border border-[#262626]">
              <img src={image.url} className="w-full h-20 object-cover opacity-60" alt="Miniature" />
              <button onClick={() => setImage(null)} className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity text-white"><Trash2 size={16} /></button>
            </div>
          )}
        </section>

        <section className={`space-y-4 ${!image ? 'opacity-30 pointer-events-none' : ''}`}>
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Activity size={14} /> Courbe Instantanée</label>
            <button onClick={() => {
              const r = { ...settings.curves, [activeChannel]: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
              setSettings(s => ({ ...s, curves: r })); setLocalCurves(r); lastKMeansResult.current = null;
            }} className="text-[10px] text-zinc-500 hover:text-white uppercase">Reset</button>
          </div>

          <div className="flex bg-[#1a1a1a] p-1 rounded-lg border border-[#262626] gap-1">
            {(['all', 'red'] as CurveChannel[]).map((c) => (
              <button key={c} onMouseDown={() => setActiveChannel(c)}
                className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${activeChannel === c ? 'bg-zinc-800 text-white shadow-sm border-b-2 border-rose-500' : 'text-zinc-500'}`}>
                {c === 'all' ? 'Master' : 'Rouge'}
              </button>
            ))}
          </div>
          
          <div className="relative aspect-square w-full bg-[#0a0a0a] rounded-xl border border-[#262626] overflow-hidden shadow-inner">
            <svg ref={curveRef} viewBox="0 0 255 255" className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
              onMouseDown={handleCurveInteraction} onMouseMove={handleCurveInteraction} onTouchStart={handleCurveInteraction} onTouchMove={handleCurveInteraction}>
              <polyline points={localCurves[activeChannel].map(p => `${p.x},${255 - p.y}`).join(' ')} fill="none" stroke={activeChannel === 'red' ? '#f43f5e' : '#fff'} strokeWidth="3" strokeLinecap="round" />
              {localCurves[activeChannel].map((p, i) => (
                <circle key={i} cx={p.x} cy={255 - p.y} r={draggingPointIndex === i ? "8" : "6"} fill={draggingPointIndex === i ? (activeChannel === 'red' ? '#f43f5e' : '#fff') : "#121212"} stroke={activeChannel === 'red' ? '#f43f5e' : '#fff'} strokeWidth="2" />
              ))}
            </svg>
          </div>
        </section>

        <div className={`space-y-6 ${!image ? 'opacity-30 pointer-events-none' : ''}`}>
          <button onClick={() => { setSettings(p => ({ ...p, isBlackAndWhite: !p.isBlackAndWhite })); lastKMeansResult.current = null; }}
            className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${settings.isBlackAndWhite ? 'bg-white text-black border-white' : 'bg-[#1a1a1a] text-zinc-400 border-[#262626]'}`}>
            <span className="text-xs font-bold flex items-center gap-2"><Contrast size={16} /> Mode Noir & Blanc</span>
            <div className={`w-8 h-4 rounded-full relative ${settings.isBlackAndWhite ? 'bg-black' : 'bg-[#262626]'}`}>
              <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${settings.isBlackAndWhite ? 'right-0.5 bg-white' : 'left-0.5 bg-zinc-600'}`} />
            </div>
          </button>

          <section>
            <div className="flex justify-between items-center mb-2"><label className="text-[10px] font-bold text-zinc-500 uppercase">Niveaux d'isolélie</label><span className="text-xs font-mono">{settings.levels}</span></div>
            <input type="range" min="2" max="16" value={settings.levels} onChange={(e) => { setSettings(s => ({ ...s, levels: parseInt(e.target.value) })); lastKMeansResult.current = null; }} className="w-full" />
          </section>

          <section>
            <div className="flex justify-between items-center mb-2"><label className="text-[10px] font-bold text-zinc-500 uppercase">Opacité du calque</label><span className="text-xs font-mono">{settings.opacity}%</span></div>
            <input type="range" min="0" max="100" value={settings.opacity} onChange={(e) => setSettings(s => ({ ...s, opacity: parseInt(e.target.value) }))} className="w-full" />
          </section>

          <button onClick={handleDownload} disabled={!processedUrl || isProcessing} className="w-full py-4 bg-white hover:bg-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-xl">
            <Download size={20} /> Exporter
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-[#0a0a0a] overflow-hidden">
        <div className="flex-1 flex items-center justify-center p-4 md:p-8">
          {!image ? (
            <div className="text-center">
              <div className="w-20 h-20 rounded-3xl bg-[#121212] border border-[#262626] flex items-center justify-center mx-auto mb-6 text-zinc-700"><ImageIcon size={40} /></div>
              <h2 className="text-xl font-light text-zinc-400">Importez une image pour commencer</h2>
            </div>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center" ref={splitRef} onMouseMove={(e) => e.buttons === 1 && handleSplitDrag(e)} onTouchMove={handleSplitDrag}>
              <div className="relative max-w-full max-h-full rounded-2xl overflow-hidden shadow-2xl border border-[#262626] bg-[#121212]">
                {curvedOnlyUrl && <img src={curvedOnlyUrl} className="max-w-full max-h-[85vh] object-contain" alt="Preview" />}
                {processedUrl && (
                  <div className="absolute inset-0 pointer-events-none" style={{ clipPath: isSplitMode ? `inset(0 0 0 ${splitPos}%)` : 'none' }}>
                    <img src={processedUrl} className="w-full h-full object-contain" alt="Final" />
                  </div>
                )}
                {isSplitMode && processedUrl && (
                  <div className="absolute inset-y-0 z-30 cursor-col-resize pointer-events-auto" style={{ left: `${splitPos}%`, transform: 'translateX(-50%)' }}>
                    <div className="h-full w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white text-black rounded-full flex items-center justify-center shadow-xl border border-zinc-200"><Columns size={14} /></div>
                  </div>
                )}
              </div>

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 bg-[#121212]/90 backdrop-blur rounded-2xl border border-[#262626] shadow-2xl z-40">
                 <button onClick={() => setIsSplitMode(true)} className={`p-2.5 rounded-xl transition-all flex items-center gap-2 px-4 ${isSplitMode ? 'bg-white text-black' : 'text-zinc-500'}`}><Columns size={16} /><span className="text-[10px] font-bold uppercase">Split</span></button>
                 <button onClick={() => setIsSplitMode(false)} className={`p-2.5 rounded-xl transition-all flex items-center gap-2 px-4 ${!isSplitMode ? 'bg-white text-black' : 'text-zinc-500'}`}><Square size={16} /><span className="text-[10px] font-bold uppercase">Full</span></button>
                 <div className="px-4 text-[10px] font-mono text-zinc-600 uppercase tracking-widest">{image.width}x{image.height}px</div>
              </div>
            </div>
          )}
        </div>
      </main>
      {(isProcessing || isInteracting) && <div className="fixed top-0 left-0 right-0 h-0.5 bg-rose-500 z-[100] animate-pulse" />}
    </div>
  );
};

export default App;
