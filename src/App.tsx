import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, Bot, User, Menu, PlusCircle, Sparkles, TerminalSquare, 
  Trash2, Command, LogIn, LogOut, MapPin, Search, Mic, MicOff, Headphones,
  Cpu, Zap, X, FileText, Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import clsx from 'clsx';
import { auth, signInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { GoogleGenAI, Modality } from "@google/genai";
import { AudioManager } from './lib/audioManager';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isVoice?: boolean;
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome-msg',
      role: 'assistant',
      content: 'Привет! Я Nebula, ваш ИИ-помощник. Чем я могу быть полезен вам сегодня?'
    }
  ]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<{ file: File; base64: string; type: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  
  // Live Voice State
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const audioManager = useRef(new AudioManager());
  const [liveTranscription, setLiveTranscription] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, liveTranscription]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: { file: File; base64: string; type: string }[] = [];
    for (const file of Array.from(files)) {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.readAsDataURL(file);
      });
      newAttachments.push({ file, base64, type: file.type });
    }

    setAttachments(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendAssistant = async (text: string) => {
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    const currentAttachments = [...attachments];
    setAttachments([]);

    try {
      const parts: any[] = [{ text }];
      currentAttachments.forEach(att => {
        parts.push({
          inlineData: {
            data: att.base64,
            mimeType: att.type
          }
        });
      });

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          ...messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
          { role: 'user', parts }
        ],
        config: {
          systemInstruction: "You are Nebula, a helpful assistant with a futuristic, cosmic vibe. If the user asks for a location or search for a place, use the googleMaps tool. Support Russian fluently.",
          tools: [{ googleMaps: {} }]
        },
      } as any);

      const responseText = response.text || "Извините, я не получил ответ.";
      
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText
      }]);

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Ошибка помощника.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && attachments.length === 0) || isLoading) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = '56px';
    await handleSendAssistant(trimmedInput);
  };

  const toggleLiveMode = async () => {
    if (isLiveMode) {
      audioManager.current.stopCapture();
      setIsLiveMode(false);
      setIsLiveConnected(false);
      setLiveTranscription('');
    } else {
      setIsLiveMode(true);
      try {
        const sessionPromise = ai.live.connect({
          model: "gemini-3.1-flash-live-preview",
          callbacks: {
            onopen: () => {
              setIsLiveConnected(true);
              audioManager.current.startCapture((base64) => {
                sessionPromise.then(s => s.sendRealtimeInput({
                  audio: { data: base64, mimeType: 'audio/pcm;rate=16000' }
                }));
              });
            },
            onmessage: async (msg: any) => {
              // Handle Voice Output
              const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audioData) {
                audioManager.current.playPcmChunk(audioData);
              }

              // Handle Transcription
              const transcription = msg.serverContent?.modelTurn?.parts?.find((p: any) => p.text)?.text;
              if (transcription) {
                setLiveTranscription(prev => prev + ' ' + transcription);
              }

              // Handle Interruption
              if (msg.serverContent?.interrupted) {
                audioManager.current.resetPlayback();
              }
            },
            onclose: () => {
              setIsLiveMode(false);
              setIsLiveConnected(false);
            }
          },
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
            },
            systemInstruction: "You are Nebula. You are in a live voice conversation with the user. Keep your responses concise and natural. Speak Russian fluently.",
          },
        });
      } catch (err) {
        console.error("Live API Error:", err);
        setIsLiveMode(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([{ id: Date.now().toString(), role: 'assistant', content: 'Черная дыра поглотила историю сообщений. Начнем заново?' }]);
  };

  return (
    <div className="flex h-screen bg-neutral-950 font-sans text-neutral-100 overflow-hidden selection:bg-brand-500/30">
      
      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'anticipate' }}
            className="flex-shrink-0 h-full glass border-r flex flex-col z-20"
          >
            <div className="p-4 flex flex-col h-full overflow-hidden w-[280px]">
              <div className="flex items-center gap-3 px-2 py-4 mb-6">
                <div className="w-9 h-9 rounded-xl bg-brand-500/10 flex items-center justify-center border border-brand-500/20">
                  <Sparkles className="text-brand-500" size={20} />
                </div>
                <h2 className="font-display font-bold text-xl tracking-tight text-white">Nebula</h2>
              </div>

              <div className="space-y-1">
                <button 
                  onClick={clearChat}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all font-medium text-sm bg-neutral-800/40 text-neutral-300 border border-neutral-700/30 hover:bg-neutral-800 hover:text-white"
                >
                  <PlusCircle size={18} />
                  Новый чат
                </button>
              </div>

              <div className="mt-8 flex-1">
                <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em] px-4 mb-4">Недавние</p>
                <div className="space-y-1">
                   <div className="px-4 py-2 text-sm text-neutral-400 hover:text-white hover:bg-neutral-800/50 rounded-lg cursor-pointer transition-colors truncate">
                    Предыдущий запрос...
                  </div>
                </div>
              </div>

              <div className="mt-auto border-t border-neutral-800 pt-4 flex flex-col space-y-2">
                {user ? (
                  <div className="group space-y-2">
                    <div className="flex items-center gap-3 px-3 py-2 text-sm text-neutral-300 w-full text-left rounded-lg transition-colors overflow-hidden">
                      <img src={user.photoURL || ''} alt={user.displayName || 'User'} className="w-6 h-6 rounded-full" />
                      <span className="truncate">{user.displayName || user.email}</span>
                    </div>
                    <button onClick={logOut} className="flex items-center gap-3 px-3 py-2 text-sm text-neutral-400 hover:text-white hover:bg-neutral-800/50 rounded-lg transition-colors w-full text-left">
                      <LogOut size={16} />
                      <span>Выйти</span>
                    </button>
                  </div>
                ) : (
                  <button onClick={signInWithGoogle} className="flex items-center gap-3 px-3 py-2 text-sm text-neutral-400 hover:text-white hover:bg-neutral-800/50 rounded-lg transition-colors w-full text-left">
                    <LogIn size={16} />
                    <span>Войти через Google</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 relative bg-neutral-950 overflow-hidden">
        
        {/* Animated Moon/Space Background */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            {/* The Moon */}
            <motion.div 
              animate={{ 
                y: [0, -10, 0],
                rotate: [0, 2, 0]
              }}
              transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-[-150px] right-[-150px] w-[600px] h-[600px] rounded-full bg-neutral-100/5 blur-[4px] shadow-[0_0_120px_rgba(255,255,255,0.03)] border border-white/5"
            >
                <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,_rgba(255,255,255,0.1),_transparent)]"></div>
            </motion.div>

            {/* Stars/Dust */}
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20"></div>
            
            {/* Ambient Glows */}
            <div className="absolute top-[20%] left-[-10%] w-[600px] h-[600px] bg-brand-500/5 rounded-full blur-[150px] animate-pulse"></div>
            <div className="absolute bottom-[-10%] right-[10%] w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '2s' }}></div>
        </div>
        
        {/* Header */}
        <header className="h-16 flex items-center px-4 md:px-6 justify-between glass-dark border-b sticky top-0 z-10 w-full">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 -ml-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center border border-brand-500/40">
                <Sparkles size={16} className="text-brand-500" />
              </div>
              <div>
                <h1 className="font-display font-semibold text-neutral-100 text-[16px] tracking-tight">Nebula</h1>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={toggleLiveMode}
              className={clsx(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-brand-500/20",
                isLiveMode ? "bg-red-500 text-white animate-pulse" : "bg-brand-500 text-white hover:bg-brand-400"
              )}
            >
              {isLiveMode ? <MicOff size={14} /> : <Mic size={14} />}
              {isLiveMode ? "Stop Live" : "Live Chat"}
            </button>
            <button 
              onClick={clearChat}
              className="p-2 text-neutral-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </header>

        {/* Message Feed */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth relative z-10 custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-8 pb-6 pt-4">
            <AnimatePresence initial={false}>
              {messages.map((message, idx) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, scale: 0.98, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className={clsx(
                    "flex gap-5 group",
                    message.role === 'user' ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div className="flex-shrink-0 mt-1">
                    <div className={clsx(
                      "w-8 h-8 rounded-full flex items-center justify-center transition-transform group-hover:scale-105",
                      message.role === 'assistant' 
                        ? "text-brand-500"
                        : "text-neutral-400"
                    )}>
                      {message.role === 'assistant' ? (
                        <Sparkles size={20} />
                      ) : (
                        user?.photoURL ? (
                          <img src={user.photoURL} alt="User" className="w-full h-full object-cover rounded-full" />
                        ) : (
                          <User size={20} />
                        )
                      )}
                    </div>
                  </div>

                  <div className={clsx(
                    "flex flex-col gap-2 max-w-[85%]",
                    message.role === 'user' ? "items-end" : "items-start"
                  )}>
                    <div className={clsx(
                      "px-5 py-3 rounded-2xl leading-relaxed text-[15px] transition-all duration-300",
                      message.role === 'user'
                        ? "bg-neutral-800 text-white" 
                        : "text-neutral-100 prose-invert"
                    )}>
                      {message.role === 'user' ? (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      ) : (
                        <div className="markdown-body prose prose-neutral prose-invert max-w-none">
                          <Markdown 
                            remarkPlugins={[remarkGfm, remarkMath]} 
                            rehypePlugins={[rehypeKatex]}
                            components={{
                              code({node, inline, className, children, ...props}: any) {
                                const match = /language-(\w+)/.exec(className || '')
                                return !inline && match ? (
                                  <SyntaxHighlighter
                                    {...props}
                                    children={String(children).replace(/\n$/, '')}
                                    style={vscDarkPlus}
                                    language={match[1]}
                                    PreTag="div"
                                    className="rounded-xl my-4 text-sm"
                                  />
                                ) : (
                                  <code {...props} className={clsx("bg-neutral-800 px-1.5 py-0.5 rounded text-sm", className)}>
                                    {children}
                                  </code>
                                )
                              }
                            }}
                          >
                            {message.content}
                          </Markdown>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}

              {isLiveMode && liveTranscription && (
                 <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-5 flex-row"
                >
                  <div className="flex-shrink-0 w-11 h-11 rounded-2xl bg-brand-500/20 flex items-center justify-center">
                    <Headphones size={24} className="text-brand-400" />
                  </div>
                  <div className="px-6 py-4 rounded-[2rem] glass bg-brand-500/5 text-neutral-300 italic text-sm">
                    {liveTranscription}...
                  </div>
                </motion.div>
              )}

              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-5"
                >
                  <div className="w-11 h-11 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                    <Zap size={24} className="text-brand-500 animate-pulse" />
                  </div>
                  <div className="px-6 py-4 rounded-3xl rounded-tl-none glass flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Floating Live Indicator */}
        <AnimatePresence>
          {isLiveMode && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20"
            >
              <div className="glass px-6 py-3 rounded-full border-brand-500/30 flex items-center gap-4 bg-neutral-900/90 shadow-2xl">
                <div className="flex items-center gap-1.5 h-6">
                  {[...Array(8)].map((_, i) => (
                    <motion.div 
                      key={i}
                      animate={{ height: isLiveConnected ? [4, Math.random() * 16 + 4, 4] : [4, 4, 4] }}
                      transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.05 }}
                      className="w-1 bg-brand-500 rounded-full"
                    />
                  ))}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-300">
                  {isLiveConnected ? "Nebula в эфире" : "Подключение..."}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Area */}
        <div className="p-4 md:p-8 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-transparent w-full relative z-10 shrink-0">
          <div className="max-w-3xl mx-auto relative group">
            
            {/* Attachments Preview */}
            <AnimatePresence>
              {attachments.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="flex flex-wrap gap-2 mb-3"
                >
                  {attachments.map((att, i) => (
                    <div key={i} className="relative group/att">
                      <div className="flex items-center gap-2 px-3 py-2 bg-neutral-800/80 backdrop-blur-md border border-neutral-700/50 rounded-xl text-xs text-neutral-300">
                        {att.type.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />}
                        <span className="max-w-[100px] truncate">{att.file.name}</span>
                        <button 
                          onClick={() => removeAttachment(i)}
                          className="ml-1 p-0.5 hover:bg-neutral-700 rounded-full transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative bg-neutral-900/40 backdrop-blur-xl border border-neutral-800/50 rounded-[2rem] shadow-2xl flex items-end p-2 transition-all focus-within:border-brand-500/50 focus-within:bg-neutral-900/60">
              <input 
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                multiple
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-4 text-neutral-400 hover:text-white rounded-full transition-all mb-1 ml-1 hover:bg-neutral-800/50"
              >
                <PlusCircle size={22} />
              </button>
              
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Спросите Nebula о чем угодно..."
                className="flex-1 max-h-[200px] min-h-[56px] py-4 px-3 bg-transparent border-none appearance-none focus:outline-none resize-none text-[15px] placeholder-neutral-500 font-medium font-display"
                style={{ height: '56px' }}
              />
              
              <button
                onClick={handleSend}
                disabled={(!input.trim() && attachments.length === 0) || isLoading}
                className={clsx(
                  "p-3 rounded-2xl mb-1 mr-1 transition-all duration-300 flex items-center justify-center group/btn shadow-xl shadow-brand-500/10",
                  (input.trim() || attachments.length > 0) && !isLoading
                    ? "bg-brand-500 text-white hover:bg-brand-400 scale-100 hover:-rotate-3"
                    : "bg-neutral-800 text-neutral-500 cursor-not-allowed scale-95 opacity-50"
                )}
              >
                <Send size={20} className={clsx("transition-transform", (input.trim() || attachments.length > 0) && !isLoading && "group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5")} />
              </button>
            </div>
            
            <div className="text-center mt-3 flex items-center justify-center gap-4 text-[10px] text-neutral-600 font-medium uppercase tracking-[0.15em] opacity-50">
              <span className="flex items-center gap-1">Nebula может ошибаться. Проверяйте важную информацию.</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
