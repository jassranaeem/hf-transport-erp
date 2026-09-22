import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, Sparkles, Cpu, AlertCircle, Bot, User, CornerDownLeft, ChevronRight } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

interface Message {
  role: "user" | "model";
  text: string;
}

interface AIAssistantProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function AIAssistant({ showFeedback }: AIAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "model",
      text: "Hello! I am your HF Transport ERP Intelligent AI Operations Assistant, powered by Google Gemini. I have real-time visibility into the fleet logistics database. How can I assist you with tracking, compliance audits, or financial margins today?"
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const samplePrompts = [
    "Which vehicles are currently delayed?",
    "What is our total revenue and profit?",
    "List all expired driver licenses or permits.",
    "Show me active transit trips and coordinates."
  ];

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim()) return;
    setMessages((prev) => [...prev, { role: "user", text: textToSend }]);
    setInput("");
    setLoading(true);

    try {
      const chatHistory = messages.map((m) => ({
        role: m.role,
        text: m.text
      }));

      const data = await enterpriseFetch("/api/gemini/chat", {
        method: "POST",
        body: JSON.stringify({ message: textToSend, chatHistory })
      });

      if (data.text) {
        setMessages((prev) => [...prev, { role: "model", text: data.text }]);
      } else {
        showFeedback("error", "Gemini API experienced an error.");
      }
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to communicate with the intelligent AI route.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-950/40 border border-slate-900 rounded-xl overflow-hidden h-[600px] flex flex-col">
      {/* Header */}
      <div className="bg-slate-950 p-4 border-b border-slate-900 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-indigo-400 animate-pulse" />
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              Intelligent Operations Assistant <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            </h3>
            <p className="text-[10px] text-slate-400">Connected to active PostgreSQL database records</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[9px] font-mono text-emerald-400">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
          ONLINE SECURE AGENT
        </div>
      </div>

      {/* Suggestion prompt cards */}
      {messages.length === 1 && (
        <div className="p-4 bg-slate-950/50 border-b border-slate-900 space-y-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Cpu className="w-3 h-3 text-indigo-400" /> Grounded database prompt suggestions:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {samplePrompts.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(prompt)}
                className="text-left p-2.5 bg-slate-900/50 hover:bg-slate-900 border border-slate-900 rounded-lg text-[11px] text-slate-300 transition flex justify-between items-center group"
              >
                <span>{prompt}</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 transition" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-900">
        {messages.map((m, idx) => (
          <div key={idx} className={`flex gap-3 max-w-[85%] ${m.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${m.role === "user" ? "bg-indigo-600" : "bg-slate-900 border border-slate-800"}`}>
              {m.role === "user" ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-indigo-400" />}
            </div>
            <div className={`p-3 rounded-xl text-xs leading-relaxed border ${
              m.role === "user" 
                ? "bg-indigo-600/10 border-indigo-500/20 text-indigo-100" 
                : "bg-slate-900/40 border-slate-900 text-slate-300"
            }`}>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3 max-w-[85%] mr-auto">
            <div className="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-indigo-400 animate-bounce" />
            </div>
            <div className="p-3 bg-slate-900/40 border border-slate-900 rounded-xl text-xs text-slate-500 italic flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s]" />
              Gemini is reasoning through operational stats...
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
        className="p-3 bg-slate-950 border-t border-slate-900 flex gap-2"
      >
        <input
          type="text"
          placeholder="Ask anything about fleet diagnostics, delays, margins, or compliance audits..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          className="flex-1 bg-slate-900 border border-slate-850 rounded-lg px-4 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shrink-0"
        >
          <Send className="w-3.5 h-3.5" /> Send
        </button>
      </form>
    </div>
  );
}
