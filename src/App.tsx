import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, Pause, SkipBack, SkipForward, FileText, Loader2, Volume2, Download } from 'lucide-react';
import { extractTextFromPdf } from './services/pdfService';
import { generateSpeech, generateSpeechPcm, VoiceName } from './services/geminiService';
import { chunkText } from './utils/textUtils';
import { concatPcmToWav } from './utils/audioUtils';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pagesText, setPagesText] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [voice, setVoice] = useState<VoiceName>('Kore');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isGeneratingFullAudio, setIsGeneratingFullAudio] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const downloadFullAudiobook = async () => {
    if (pagesText.length === 0 || !file) return;
    
    setIsGeneratingFullAudio(true);
    setGenerationProgress(0);
    setError(null);
    
    try {
      const allPcmChunks: string[] = [];
      let totalChunks = 0;
      
      // First, calculate total chunks
      const allTextChunks: string[] = [];
      for (let i = 0; i < pagesText.length; i++) {
        const text = pagesText[i];
        if (!text || text.trim().length === 0) continue;
        const chunks = chunkText(text, 1000);
        allTextChunks.push(...chunks);
      }
      
      totalChunks = allTextChunks.length;
      
      if (totalChunks === 0) {
        throw new Error('No audio could be generated from this document.');
      }

      for (let i = 0; i < allTextChunks.length; i++) {
        const chunk = allTextChunks[i];
        const pcm = await generateSpeechPcm(chunk, voice);
        allPcmChunks.push(pcm);
        setGenerationProgress(Math.round(((i + 1) / totalChunks) * 100));
        
        // Add a 4.5 second delay between chunks to respect the 15 RPM free tier limit
        // Only delay if it's not the last chunk
        if (i < allTextChunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 4500));
        }
      }
      
      const fullAudioUrl = concatPcmToWav(allPcmChunks, 24000);
      
      // Trigger download
      const a = document.createElement('a');
      a.href = fullAudioUrl;
      a.download = `${file.name.replace(/\.[^/.]+$/, "")}-full-audiobook.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(fullAudioUrl);
      
    } catch (err: any) {
      console.error('Error generating full audiobook:', err);
      setError('Failed to generate full audiobook. Please try again.');
    } finally {
      setIsGeneratingFullAudio(false);
      setGenerationProgress(0);
    }
  };
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    if (selectedFile.type !== 'application/pdf') {
      setError('Please upload a valid PDF file.');
      return;
    }

    setFile(selectedFile);
    setError(null);
    setIsExtracting(true);
    setPagesText([]);
    setCurrentPage(0);
    setAudioUrl(null);
    setIsPlaying(false);

    try {
      const extractedPages = await extractTextFromPdf(selectedFile);
      setPagesText(extractedPages);
    } catch (err: any) {
      console.error('Error extracting text:', err);
      setError('Failed to extract text from PDF. Ensure it is a valid text-based PDF.');
    } finally {
      setIsExtracting(false);
    }
  };

  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [pageChunks, setPageChunks] = useState<string[]>([]);

  const playPage = async (pageIndex: number, chunkIndex = 0) => {
    if (pageIndex < 0 || pageIndex >= pagesText.length) return;
    
    setCurrentPage(pageIndex);
    const text = pagesText[pageIndex];
    
    if (!text || text.trim().length === 0) {
      setError('This page appears to be empty or contains no readable text.');
      return;
    }

    const chunks = chunkText(text, 1000);
    setPageChunks(chunks);
    setCurrentChunkIndex(chunkIndex);

    if (chunkIndex >= chunks.length) {
      // Move to next page if done with chunks
      if (pageIndex < pagesText.length - 1) {
        playPage(pageIndex + 1, 0);
      } else {
        setIsPlaying(false);
      }
      return;
    }

    setIsGeneratingAudio(true);
    setError(null);
    setAudioUrl(null);
    setIsPlaying(false);

    try {
      const textToRead = chunks[chunkIndex];
      const url = await generateSpeech(textToRead, voice);
      setAudioUrl(url);
      setIsPlaying(true);
    } catch (err: any) {
      console.error('Error generating speech:', err);
      setError('Failed to generate audio. Please try again.');
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.play().catch(err => {
        console.error('Playback failed:', err);
        setIsPlaying(false);
      });
    }
  }, [audioUrl]);

  const togglePlayPause = () => {
    if (!audioRef.current || !audioUrl) {
      if (pagesText.length > 0 && !isGeneratingAudio) {
        playPage(currentPage, 0);
      }
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    // Play next chunk or next page
    playPage(currentPage, currentChunkIndex + 1);
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-stone-200">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone-900 text-white rounded-xl flex items-center justify-center shadow-sm">
              <Volume2 size={20} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">PDF to Audiobook</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-stone-600">Voice:</label>
            <select 
              value={voice} 
              onChange={(e) => setVoice(e.target.value as VoiceName)}
              className="bg-stone-100 border-none rounded-lg px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-stone-900 outline-none cursor-pointer"
            >
              <option value="Kore">Kore (Female)</option>
              <option value="Puck">Puck (Male)</option>
              <option value="Charon">Charon (Male)</option>
              <option value="Fenrir">Fenrir (Male)</option>
              <option value="Zephyr">Zephyr (Female)</option>
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {!file ? (
          <div className="max-w-2xl mx-auto">
            <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-stone-300 border-dashed rounded-2xl cursor-pointer bg-white hover:bg-stone-50 transition-colors group">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <div className="w-16 h-16 mb-4 rounded-full bg-stone-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8 text-stone-500" />
                </div>
                <p className="mb-2 text-lg font-medium text-stone-700">
                  <span className="font-semibold">Click to upload</span> or drag and drop
                </p>
                <p className="text-sm text-stone-500">PDF files only</p>
              </div>
              <input 
                type="file" 
                className="hidden" 
                accept="application/pdf" 
                onChange={handleFileUpload} 
              />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Player & Controls */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200">
                <div className="aspect-square bg-stone-100 rounded-xl mb-6 flex items-center justify-center relative overflow-hidden">
                  {isExtracting ? (
                    <div className="flex flex-col items-center text-stone-500">
                      <Loader2 className="w-10 h-10 animate-spin mb-3" />
                      <span className="text-sm font-medium">Extracting Text...</span>
                    </div>
                  ) : (
                    <FileText className="w-24 h-24 text-stone-300" />
                  )}
                </div>

                <div className="text-center mb-8">
                  <h2 className="text-lg font-semibold truncate" title={file.name}>
                    {file.name}
                  </h2>
                  <p className="text-sm text-stone-500 mt-1">
                    {pagesText.length > 0 ? `${pagesText.length} Pages` : 'Processing...'}
                  </p>
                </div>

                <div className="flex items-center justify-center gap-4">
                  <button 
                    onClick={() => playPage(currentPage - 1, 0)}
                    disabled={currentPage === 0 || isExtracting || isGeneratingAudio || isGeneratingFullAudio}
                    className="p-3 rounded-full hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-stone-700"
                  >
                    <SkipBack size={24} fill="currentColor" />
                  </button>
                  
                  <button 
                    onClick={togglePlayPause}
                    disabled={isExtracting || pagesText.length === 0 || isGeneratingFullAudio}
                    className="w-16 h-16 rounded-full bg-stone-900 text-white flex items-center justify-center hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg active:scale-95"
                  >
                    {isGeneratingAudio ? (
                      <Loader2 size={28} className="animate-spin" />
                    ) : isPlaying ? (
                      <Pause size={28} fill="currentColor" />
                    ) : (
                      <Play size={28} fill="currentColor" className="ml-1" />
                    )}
                  </button>
                  
                  <button 
                    onClick={() => playPage(currentPage + 1, 0)}
                    disabled={currentPage === pagesText.length - 1 || isExtracting || isGeneratingAudio || isGeneratingFullAudio}
                    className="p-3 rounded-full hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-stone-700"
                  >
                    <SkipForward size={24} fill="currentColor" />
                  </button>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                  {audioUrl && (
                    <a 
                      href={audioUrl} 
                      download={`${file.name.replace(/\.[^/.]+$/, "")}-page-${currentPage + 1}-part-${currentChunkIndex + 1}.wav`}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-sm font-medium transition-colors w-full"
                    >
                      <Download size={18} />
                      Download Current Audio
                    </a>
                  )}
                  
                  <button
                    onClick={downloadFullAudiobook}
                    disabled={isExtracting || pagesText.length === 0 || isGeneratingAudio || isGeneratingFullAudio}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-sm font-medium transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGeneratingFullAudio ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Generating Full Audiobook ({generationProgress}%)...
                      </>
                    ) : (
                      <>
                        <Download size={18} />
                        Download Full Audiobook
                      </>
                    )}
                  </button>
                </div>

                {audioUrl && (
                  <audio 
                    ref={audioRef} 
                    src={audioUrl} 
                    onEnded={handleAudioEnded}
                    onPause={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                    className="hidden"
                  />
                )}
              </div>

              {error && (
                <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm border border-red-100">
                  {error}
                </div>
              )}
            </div>

            {/* Right Column: Text Content */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden h-[calc(100vh-12rem)] flex flex-col">
                <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/50 flex items-center justify-between">
                  <h3 className="font-medium text-stone-700">
                    Page {currentPage + 1} of {Math.max(1, pagesText.length)}
                  </h3>
                  {pagesText.length > 0 && (
                    <div className="text-xs font-mono text-stone-400">
                      {pagesText[currentPage]?.length || 0} chars
                    </div>
                  )}
                </div>
                
                <div className="p-8 overflow-y-auto flex-1 text-stone-800 leading-relaxed text-lg font-serif">
                  {isExtracting ? (
                    <div className="h-full flex items-center justify-center text-stone-400">
                      Reading document...
                    </div>
                  ) : pagesText.length > 0 ? (
                    <div className="whitespace-pre-wrap">
                      {pagesText[currentPage]}
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-stone-400">
                      No text found.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
