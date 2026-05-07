import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { motion } from 'motion/react';
import {
  Mic,
  Database,
  CreditCard,
  MessageSquareShare,
  ArrowRight,
  ChevronRight,
  BarChart,
  FileText,
  Lock,
  Globe,
  Plus,
  Minus,
  Square,
  X
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

function Navbar({ onDemo }: { onDemo: () => void }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-[#0B0F19]/80 backdrop-blur-md border-b border-white/10">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-white" />
        <span className="font-semibold tracking-tight text-white hidden sm:block">Nexus Web Agency</span>
      </div>
      <div className="hidden md:flex items-center gap-8 text-sm text-gray-400">
        <a href="#features" className="hover:text-white transition-colors">Features</a>
        <a href="#metrics" className="hover:text-white transition-colors">Results</a>
        <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
      </div>
      <div className="flex items-center gap-4">
        <button onClick={onDemo} className="px-5 py-2 text-sm font-medium text-teal-50 bg-teal-500/10 border border-teal-500/20 rounded-full hover:bg-teal-500/20 transition-all shadow-sm">
          Book Demo
        </button>
      </div>
    </nav>
  );
}

function HeroWidget() {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState('IDLE');
  const [duration, setDuration] = useState(0); 
  const sessionPromiseRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextTimeRef = useRef<number>(0);

  useEffect(() => {
    let interval: any;
    if (isActive) {
      interval = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(interval);
  }, [isActive]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const startLiveAPI = async () => {
    setStatus('CONNECTING...');
    setIsActive(true);
    
    playbackCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    nextTimeRef.current = playbackCtxRef.current.currentTime;
    
    let audioCtx: AudioContext;
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    } catch(e) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    audioCtxRef.current = audioCtx;
    
    try {
      if (playbackCtxRef.current?.state === 'suspended') {
         await playbackCtxRef.current.resume();
      }
      if (audioCtx.state === 'suspended') {
         await audioCtx.resume();
      }
      
      // Request mic before connect to avoid delay, though this part is async
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: async () => {
            setStatus('LISTENING');
            try {
               if (!audioCtxRef.current || !streamRef.current) return;
               
               const source = audioCtxRef.current.createMediaStreamSource(streamRef.current);
               const processor = audioCtxRef.current.createScriptProcessor(4096, 1, 1);
               processorRef.current = processor;
               
               processor.onaudioprocess = (e) => {
                 const data = e.inputBuffer.getChannelData(0);
                 const pcm16 = new Int16Array(data.length);
                 for (let i = 0; i < data.length; i++) {
                   pcm16[i] = Math.min(1, Math.max(-1, data[i])) * 0x7FFF;
                 }
                 const uint8 = new Uint8Array(pcm16.buffer);
                 let binary = '';
                 for (let i = 0; i < uint8.length; i++) {
                   binary += String.fromCharCode(uint8[i]);
                 }
                 const base64Data = btoa(binary);
                 
                 sessionPromise.then((session: any) =>
                   session.sendRealtimeInput({
                     audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                   })
                 );
               };
               
               source.connect(processor);
               const gainNode = audioCtxRef.current.createGain();
               gainNode.gain.value = 0;
               processor.connect(gainNode);
               gainNode.connect(audioCtxRef.current.destination);
               
            } catch(err) {
              console.error("Mic error", err);
              setStatus('ERROR');
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && playbackCtxRef.current) {
              setStatus('SPEAKING'); 
              const binary = atob(base64Audio);
              const validLen = binary.length - (binary.length % 2);
              const bytes = new Uint8Array(validLen);
              for (let i = 0; i < validLen; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              const pcm16 = new Int16Array(bytes.buffer, 0, validLen / 2);
              const float32 = new Float32Array(pcm16.length);
              for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / 0x7FFF;
              }
              
              const buffer = playbackCtxRef.current.createBuffer(1, float32.length, 24000);
              buffer.getChannelData(0).set(float32);
              
              const source = playbackCtxRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(playbackCtxRef.current.destination);
              
              const currentTime = playbackCtxRef.current.currentTime;
              if (nextTimeRef.current < currentTime) {
                nextTimeRef.current = currentTime;
              }
              source.start(nextTimeRef.current);
              nextTimeRef.current += buffer.duration;
              
              source.onended = () => {
                 setStatus((prev) => prev === 'SPEAKING' ? 'LISTENING' : prev);
              };
            }
            if (message.serverContent?.interrupted) {
              nextTimeRef.current = playbackCtxRef.current ? playbackCtxRef.current.currentTime : 0;
            }
          },
          onerror: (err) => {
              console.error(err);
              setStatus('ERROR');
          },
          onclose: () => {
              setStatus('IDLE');
              stopAudio();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are an autonomous AI Sales Agent named Nexus. You work for a web design agency that builds websites for small businesses featuring embedded AI assistants. The AI we build can answer questions, handle inquiries, and take orders for small businesses. You are taking a voice call from a visitor on our agency's landing page. Your goal is to sell our web design & AI services. Keep responses concise, professional, and conversational. Explain how an AI website can help them get more leads and automate customer service. If they seem interested, guide them to click the 'Book a Demo' button on the page.",
        },
      });
      sessionPromiseRef.current = sessionPromise;
    } catch(err) {
      console.error(err);
      setStatus('ERROR');
      setIsActive(false);
    }
  };

  const stopAudio = () => {
     setIsActive(false);
     setStatus('IDLE');
     if(processorRef.current) processorRef.current.disconnect();
     processorRef.current = null;
     if(streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
     streamRef.current = null;
     if(audioCtxRef.current) audioCtxRef.current.close();
     audioCtxRef.current = null;
     if(playbackCtxRef.current) playbackCtxRef.current.close();
     playbackCtxRef.current = null;
     if(sessionPromiseRef.current) {
         sessionPromiseRef.current.then((session: any) => session.close());
         sessionPromiseRef.current = null;
     }
  };

  const toggleCall = () => {
     if(isActive) stopAudio();
     else startLiveAPI();
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.2 }}
      className="relative w-full max-w-lg mx-auto"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-teal-500/20 via-transparent to-transparent blur-3xl" />
      <div className="relative overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.1)] bg-white/[0.03] backdrop-blur-md shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.05)] bg-white/[0.01]">
          <div className="flex items-center gap-2.5">
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-teal-400 animate-pulse shadow-[0_0_8px_rgba(45,212,191,0.8)]' : 'bg-gray-500'}`} />
            <span className="text-[11px] font-mono font-medium tracking-wider text-gray-400 uppercase">STATUS: {status}</span>
          </div>
          <span className="text-[11px] font-mono tracking-wider text-gray-400">{formatTime(duration)}</span>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          <div className="flex flex-col items-center justify-center space-y-4 py-6">
            <button 
              onClick={toggleCall}
              className={`relative flex items-center justify-center w-24 h-24 rounded-full border transition-all cursor-pointer ${
                isActive 
                  ? 'border-red-500/50 bg-red-500/10 hover:bg-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.2)]' 
                  : 'border-[rgba(255,255,255,0.1)] bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              {isActive && (
                <div className="absolute inset-0 rounded-full border border-red-500/50 animate-ping opacity-20" />
              )}
              {isActive ? <Square className="w-8 h-8 text-red-500 fill-red-500" /> : <Mic className="w-8 h-8 text-white" />}
            </button>
          </div>


        </div>
      </div>
    </motion.div>
  );
}

function Hero({ onDemo }: { onDemo: () => void }) {
  return (
    <>
      <section className="relative min-h-[90vh] flex flex-col justify-center pt-32 pb-20 px-6 overflow-hidden">
        <div className="w-full max-w-7xl mx-auto z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center">
          
          <div className="text-left w-full max-w-2xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[rgba(255,255,255,0.1)] bg-white/[0.03] backdrop-blur-md mb-8"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
              <span className="text-[10px] sm:text-xs font-semibold tracking-wider text-teal-50 uppercase">Nexus Web Agency Live</span>
            </motion.div>
            
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[1.05] mb-8"
            >
              <span className="text-white">Websites that work.</span><br className="hidden sm:block" />
              <span className="bg-gradient-to-r from-teal-400 to-emerald-300 bg-clip-text text-transparent">Autonomously.</span>
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-lg md:text-xl text-gray-400 mb-10 leading-relaxed font-light"
            >
              We build premium websites for small businesses, featuring embedded AI agents that handle customer inquiries, take orders, and capture leads 24/7.
            </motion.p>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="flex items-center"
            >
              <button onClick={onDemo} className="w-full sm:w-auto px-8 py-3.5 text-sm font-medium text-[#0B0F19] bg-teal-400 hover:bg-teal-300 transition-all rounded-full flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(45,212,191,0.3)]">
                Book a Demo <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          </div>

          <div className="relative w-full flex justify-center lg:justify-end">
            <HeroWidget />
          </div>
        </div>
      </section>

      {/* Social Proof Banner */}
      <section className="py-12 border-y border-[rgba(255,255,255,0.05)] bg-[#0B0F19]/50 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-xs font-mono tracking-widest text-gray-500 mb-8 uppercase">Trusted by leaders at</p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
            {/* Placeholder Logos */}
            <div className="flex items-center gap-2 font-bold text-xl tracking-tight"><div className="w-6 h-6 bg-white rounded-sm" /> ACME Corp</div>
            <div className="flex items-center gap-2 font-bold text-xl tracking-tight"><div className="w-6 h-6 rounded-full border-2 border-white" /> GlobalTech</div>
            <div className="flex items-center gap-2 font-bold text-xl tracking-tight"><div className="w-6 h-6 bg-white rotate-45" /> NexusLink</div>
            <div className="flex items-center gap-2 font-bold text-xl tracking-tight"><div className="w-6 h-6 border-2 border-white rounded-br-xl" /> InnovateSpace</div>
            <div className="flex items-center gap-2 font-bold text-xl tracking-tight hidden md:flex"><div className="w-6 h-6 bg-white rounded-tl-xl rounded-br-xl" /> CloudSync</div>
          </div>
        </div>
      </section>
    </>
  );
}

function Features() {
  const features = [
    {
      title: "Always On 24/7",
      description: "Seamlessly switch between ultra-low latency voice streaming and rich text chat in the same session. Your agent never sleeps.",
      icon: Mic,
      className: "md:col-span-2 md:row-span-2",
      viz: (
        <div className="absolute inset-x-6 bottom-6 h-32 bg-gradient-to-t from-[#0B0F19] to-transparent rounded-lg border border-[rgba(255,255,255,0.05)] overflow-hidden flex flex-col justify-end p-6">
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1.5 text-xs font-medium bg-teal-500/20 text-teal-300 rounded-md shadow-sm border border-teal-500/30">Voice Stream</span>
            <span className="px-3 py-1.5 text-xs font-medium border border-[rgba(255,255,255,0.1)] text-gray-400 bg-white/[0.02] rounded-md">Live Chat</span>
          </div>
        </div>
      )
    },
    {
      title: "Knowledge Sync",
      description: "We train your AI on your own business documents, menus, and product catalogs so it knows everything about your business.",
      icon: Database,
      className: "md:col-span-1 lg:col-span-1",
      viz: (
        <div className="absolute right-0 bottom-0 pointer-events-none opacity-[0.2] flex gap-2 p-6 translate-x-2 translate-y-4">
           <div className="w-16 h-20 border border-[rgba(255,255,255,0.2)] rounded-lg bg-teal-500/10 -rotate-12 transform origin-bottom-right backdrop-blur-sm" />
           <div className="w-16 h-20 border border-[rgba(255,255,255,0.3)] rounded-lg bg-white/[0.05] shadow-xl backdrop-blur-md" />
        </div>
      )
    },
    {
      title: "Autonomous Checkout",
      description: "Generates secure Stripe payment links directly inside the conversation.",
      icon: CreditCard,
      className: "md:col-span-1 lg:col-span-1",
      viz: (
        <div className="absolute -right-4 -bottom-4 pointer-events-none opacity-30">
           <div className="w-32 h-20 border border-[rgba(255,255,255,0.1)] rounded-xl bg-gradient-to-br from-white/[0.1] to-transparent p-2 flex flex-col justify-between -rotate-6 backdrop-blur-sm">
             <div className="w-4 h-3 bg-white/20 rounded-sm" />
             <div className="w-12 h-2 bg-white/10 rounded-full" />
           </div>
        </div>
      )
    },
    {
      title: "Human Escalation",
      description: "Detects complex inquiries and instantly notifies your team via email or SMS to step in.",
      icon: MessageSquareShare,
      className: "md:col-span-2 lg:col-span-2",
      viz: null
    }
  ];

  return (
    <section id="features" className="py-20 md:py-24 px-6 bg-[#0B0F19]">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 md:mb-16 text-center md:text-left">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4 text-white">The architecture of autonomy.</h2>
          <p className="text-gray-400 text-lg font-light max-w-2xl mx-auto md:mx-0">Everything you need to turn visitors into booked revenue, built natively into one single lightweight snippet.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 auto-rows-auto md:auto-rows-[280px]">
          {features.map((feature, i) => (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              key={feature.title}
              className={`relative overflow-hidden rounded-3xl bg-white/[0.02] border border-[rgba(255,255,255,0.05)] p-8 group hover:border-[rgba(255,255,255,0.1)] hover:bg-white/[0.03] transition-all shadow-xl ${feature.className}`}
            >
              <div className="relative z-10 w-full sm:w-[80%] md:w-[90%]">
                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-6">
                  <feature.icon className="w-6 h-6 text-teal-400" />
                </div>
                <h3 className="text-xl font-semibold mb-3 text-white">{feature.title}</h3>
                <p className="text-gray-400 font-light leading-relaxed">{feature.description}</p>
              </div>
              {feature.viz}
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metrics() {
  return (
    <section id="metrics" className="py-20 md:py-24 px-6 border-y border-white/5 bg-[#070A12]">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">Forms are dead.<br/>Conversations convert.</h2>
          <p className="text-gray-400 text-lg font-light mb-8 max-w-lg leading-relaxed">
            Passive lead generation relies on hoping the user fills out a 10-field form. Nexus actively hunts for the conversion by asking the right questions, handling pricing objections, and accelerating the deal.
          </p>
          <ul className="space-y-4">
            {['4.2x average increase in leads captured', 'Zero configuration deployment', 'Connects directly to your email or existing CRM'].map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-sm text-gray-300">
                <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                  <CheckIcon />
                </div>
                {item}
              </li>
            ))}
          </ul>
        </div>
        
        <div className="relative aspect-square md:aspect-video lg:aspect-square bg-white/[0.02] rounded-3xl border border-[rgba(255,255,255,0.05)] p-8 flex flex-col justify-between overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 blur-[100px] pointer-events-none" />
          <div className="relative z-10">
            <h3 className="text-sm font-mono text-gray-400 uppercase tracking-widest mb-1">Conversion Rate</h3>
            <div className="text-4xl font-light text-white mb-8">Outbound vs Nexus</div>
          </div>

          <div className="relative z-10 flex items-end gap-4 sm:gap-6 h-48 sm:h-64 mt-auto">
            
            {/* Background Lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-8">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="w-full border-t border-white/5" />
              ))}
            </div>

            {/* Old Method */}
            <div className="w-full h-full flex flex-col justify-end items-center gap-3 group relative z-10">
              <div className="text-lg sm:text-xl text-gray-500 font-medium text-center transition-colors">1.2%</div>
              <motion.div 
                initial={{ height: 0 }}
                whileInView={{ height: '30%' }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 1, ease: 'easeOut' }}
                className="w-full bg-[#111] border border-white/10 rounded-t-lg relative overflow-hidden" 
              >
                <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/5" />
              </motion.div>
              <div className="text-[10px] sm:text-xs text-center text-gray-500 uppercase tracking-widest font-mono">Form</div>
            </div>

            {/* Nexus Method */}
            <div className="w-full h-full flex flex-col justify-end items-center gap-3 group relative z-10">
              <div className="text-2xl sm:text-3xl font-medium text-center text-white drop-shadow-md">5.4%</div>
              <motion.div 
                initial={{ height: 0 }}
                whileInView={{ height: '85%' }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
                className="w-full bg-white rounded-t-lg relative overflow-hidden shadow-[0_0_40px_rgba(255,255,255,0.2)]" 
              >
                <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white to-transparent opacity-50" />
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-gray-200/20 to-transparent" />
              </motion.div>
              <div className="text-[10px] sm:text-xs text-center text-white uppercase tracking-widest font-mono">Agent</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-white" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}

function Testimonials() {
  const testimonials = [
    {
       quote: "Nexus rebuilt our plumbing business website and added the AI agent. We're booking 3x more appointments because the AI handles middle-of-the-night calls and schedules them directly.",
       author: "Sarah Jenkins",
       role: "Owner, Jenkins Plumbing"
    },
    {
       quote: "Our old website was just a digital brochure. Now, customers land on the site, ask AI about our catering menu, and place orders directly. It feels like having a full-time sales rep.",
       author: "Michael Chang",
       role: "Founder, Lotus Catering"
    },
    {
       quote: "I was skeptical about AI, but Nexus made it easy. The agent knows our entire inventory. If a customer asks if we have a specific part in stock, it checks and replies instantly.",
       author: "David Miller",
       role: "Manager, AutoParts Direct"
    }
  ];

  return (
    <section className="py-20 md:py-24 px-6 bg-[#0B0F19] border-b border-white/5">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-center mb-12 flex flex-col items-center">
          Trusted by small businesses.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <div key={i} className="p-8 rounded-3xl bg-white/[0.02] border border-[rgba(255,255,255,0.05)] flex flex-col justify-between">
              <div className="mb-6">
                <div className="flex gap-1 mb-4 text-white">
                   {[...Array(5)].map((_, j) => (
                     <svg key={j} className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                       <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                     </svg>
                   ))}
                </div>
                <p className="text-gray-400 font-light leading-relaxed text-sm">"{t.quote}"</p>
              </div>
              <div>
                <div className="text-white font-medium text-sm">{t.author}</div>
                <div className="text-gray-500 text-xs">{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    { q: "How long does it take to train the AI for my business?", a: "During the web design process, we'll ask for your FAQs, menus, or service lists. We train the AI so it's ready to go the moment your site launches." },
    { q: "Does it support multiple languages?", a: "Yes. Nexus natively comprehends and responds in over 40 languages with ultra-low latency, recognizing language switches in real-time." },
    { q: "What if the AI doesn't know the answer?", a: "If the AI encounters a question it is not trained on, it politely takes a message from the customer and forwards the inquiry directly to your email or SMS." },
    { q: "Can I customize the agent's voice and tone?", a: "Absolutely. You can select from 15 professional voice models and define a strict system prompt to control formatting, tone (e.g., direct, helpful, energetic), and hard constraints." }
  ];

  return (
    <section id="faq" className="py-20 md:py-24 px-6 max-w-3xl mx-auto">
      <h2 className="text-3xl font-bold tracking-tight text-center mb-12">Frequently asked questions.</h2>
      <div className="space-y-4">
        {faqs.map((faq, i) => (
          <FAQItem key={i} question={faq.q} answer={faq.a} />
        ))}
      </div>
    </section>
  );
}

function FAQItem({ question, answer }: { question: string, answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-[rgba(255,255,255,0.05)] rounded-2xl bg-white/[0.02] overflow-hidden shadow-sm">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="w-full flex items-center justify-between p-6 text-left"
      >
        <span className="font-medium text-white">{question}</span>
        {isOpen ? <Minus className="w-4 h-4 text-gray-400" /> : <Plus className="w-4 h-4 text-gray-400" />}
      </button>
      <motion.div 
        initial={false}
        animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
        className="overflow-hidden"
      >
        <div className="p-6 pt-0 text-sm text-gray-400 font-light leading-relaxed">
          {answer}
        </div>
      </motion.div>
    </div>
  );
}

function CTA({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="py-20 md:py-24 px-6 border-t border-white/5 bg-[#0B0F19]">
      <div className="max-w-4xl mx-auto text-center relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-teal-500/10 blur-[100px] pointer-events-none rounded-full" />
        <h2 className="relative text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-6">Ready to upgrade your web presence?</h2>
        <p className="relative text-base sm:text-lg text-gray-400 font-light max-w-xl mx-auto mb-10 px-4">
          Let us build a stunning website for your small business, supercharged with an AI assistant that drives sales on autopilot.
        </p>
        <div className="relative flex flex-col sm:flex-row items-center justify-center gap-4">
          <button onClick={onDemo} className="w-full sm:w-auto px-8 py-4 text-sm font-medium text-[#0B0F19] bg-teal-400 hover:bg-teal-300 transition-all rounded-full text-center shadow-[0_0_20px_rgba(45,212,191,0.3)]">
            Book a demo
          </button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-12 px-6 border-t border-white/5 text-sm text-gray-500 flex flex-col md:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-white/20" />
        <span className="font-semibold text-gray-300">Nexus Web Agency</span>
      </div>
      <div className="flex gap-6">
        <a href="#" className="hover:text-white transition-colors">Privacy</a>
        <a href="#" className="hover:text-white transition-colors">Terms</a>
        <a href="#" className="hover:text-white transition-colors">Twitter</a>
      </div>
      <div>&copy; {new Date().getFullYear()} Nexus Web Agency.</div>
    </footer>
  );
}

function Modal({ type, onClose }: { type: 'demo', onClose: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const content = {
    demo: { title: 'Book a Demo', desc: 'See how our AI-powered websites can transform your business.', btn: 'Schedule Demo' },
  }[type];

  if (submitted) {
     return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md p-6 sm:p-8 bg-[#0B0F19] border border-[rgba(255,255,255,0.1)] rounded-[24px] relative shadow-2xl text-center"
          >
            <button onClick={onClose} className="absolute top-4 right-4 p-2 text-gray-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
            </button>
            <div className="w-12 h-12 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
               <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                 <polyline points="20 6 9 17 4 12"></polyline>
               </svg>
            </div>
            <h3 className="text-xl font-medium text-white mb-2">Request Sent</h3>
            <p className="text-sm text-gray-400 mb-6">We'll be in touch shortly to schedule your demo.</p>
          </motion.div>
        </div>
     );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md p-6 sm:p-8 bg-[#0B0F19] border border-[rgba(255,255,255,0.1)] rounded-[24px] relative shadow-2xl overflow-y-auto max-h-screen"
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
        </button>
        <h3 className="text-xl font-medium text-white mb-2 pr-8">{content?.title}</h3>
        <p className="text-sm text-gray-400 mb-6">{content?.desc}</p>
        
        <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} className="space-y-4 text-left">
           <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Name</label>
              <input required type="text" placeholder="John Doe" className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-white/30" />
           </div>
           <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Email</label>
              <input required type="email" placeholder="name@company.com" className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-white/30" />
           </div>
           <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Business Name</label>
              <input required type="text" placeholder="Acme Corp" className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-white/30" />
           </div>
           <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Message (Optional)</label>
              <textarea placeholder="How can we help you?" className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-white/30 min-h-[80px]" />
           </div>
           <button type="submit" className="w-full py-3 text-sm font-medium text-black bg-white hover:bg-gray-200 transition-colors rounded-lg mt-2">
             {content?.btn}
           </button>
        </form>
      </motion.div>
    </div>
  );
}

export default function App() {
  const [modalType, setModalType] = useState<'demo' | null>(null);

  return (
    <div className="bg-[#0B0F19] min-h-screen text-white selection:bg-teal-500/30 relative">
      <Navbar onDemo={() => setModalType('demo')} />
      <main>
        <Hero onDemo={() => setModalType('demo')} />
        <Features />
        <Metrics />
        <Testimonials />
        <FAQ />
        <CTA onDemo={() => setModalType('demo')} />
      </main>
      <Footer />
      {modalType && <Modal type={modalType} onClose={() => setModalType(null)} />}
    </div>
  );
}
