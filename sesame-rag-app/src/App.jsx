import React, { useState, useRef, useEffect } from "react";
import {
  Send, Bot, User, FileText, Search, Loader2, Droplet,
  ClipboardList, Shield, Package, Users, Sparkles, Radio, Plus
} from "lucide-react";

// ---------------------------------------------------------------------------
// Mock knowledge base — stands in for the client's real documents
// (price sheets, SOPs, lab certificates, stock registers, distributor terms)
// ---------------------------------------------------------------------------
const DOCUMENTS = [
  {
    id: "price-sept",
    title: "Price List — September 2026",
    icon: Package,
    content:
      "Effective 1 September 2026, approved ex-factory rates: Black sesame seed (raw, graded) Hyderabad Rs 168/kg, Vijayawada Rs 162/kg, Chennai Rs 171/kg, Bengaluru Rs 174/kg. Cold-pressed black sesame oil (1 litre bottle) Hyderabad Rs 640, Vijayawada Rs 610, Chennai Rs 655, Bengaluru Rs 665. Rates revised monthly based on raw seed procurement cost. Distributors must confirm the current sheet before quoting a customer.",
  },
  {
    id: "sop-extraction",
    title: "SOP — Cold Press Extraction",
    icon: Droplet,
    content:
      "Cold Press Extraction Procedure: 1) Clean seed to remove stones and husk using the vibratory sieve. 2) Feed seed into the cold press expeller at room temperature — do not exceed 45°C during pressing, this preserves nutrients and flavour compared to hot extraction. 3) Collect crude oil into the settling tank for 24 hours. 4) Filter through a 5-micron cloth filter to remove sediment. 5) Bottle in sanitised, sealed containers within 48 hours of filtration. Operators must wear gloves and hairnets throughout. Machine must be cleaned between every batch change.",
  },
  {
    id: "cert-batch214",
    title: "Quality Certificate — Batch 214",
    icon: Shield,
    content:
      "Batch 214 (black sesame oil, cold-pressed, packed 18 August 2026): FSSAI License No. 12345678901234 — valid, renewed March 2026. Lab test report dated 20 August 2026 confirms purity 99.2%, moisture content 0.3%, free fatty acid 1.1% (within permissible limit of 2%). Batch approved for sale and export documentation. Certificate on file with the Vijayawada quality office.",
  },
  {
    id: "stock-dispatch",
    title: "Stock & Dispatch Register",
    icon: ClipboardList,
    content:
      "Current warehouse stock (as of latest update): Hyderabad — 3,200 kg seed, 1,150 litres oil. Vijayawada (main unit) — 8,400 kg seed, 2,600 litres oil. Chennai — 1,800 kg seed, 640 litres oil. Bengaluru — 2,100 kg seed, 720 litres oil. Chennai oil stock is below the 800-litre reorder threshold; dispatch from Vijayawada is scheduled within 3 working days of a distributor order.",
  },
  {
    id: "distributor-policy",
    title: "Distributor Terms & Policy",
    icon: Users,
    content:
      "Minimum order quantity for new distributors: 500 kg seed or 200 litres oil per order. Payment terms: 30% advance, balance on dispatch, except for distributors with 12+ months standing who get 15-day credit. Returns accepted only for verified quality defects within 7 days of delivery, supported by a lab report. Exclusive city territory is granted only after 3 consecutive quarters of meeting minimum volume.",
  },
];

// Cities the live sales feed reports for — mirrors the price list above
const CITIES = ["Hyderabad", "Vijayawada", "Chennai", "Bengaluru"];

function buildSalesDoc(salesByCity, updatedAt) {
  const lines = CITIES.map(
    (c) => `${c}: Rs ${salesByCity[c].toLocaleString("en-IN")}`
  ).join(", ");
  const total = Object.values(salesByCity).reduce((a, b) => a + b, 0);
  return {
    id: "live-sales",
    title: "Today's Sales (live feed)",
    icon: Radio,
    live: true,
    updatedAt,
    content: `Running sales total for today, as reported by the POS/ERP feed, last synced ${updatedAt}: ${lines}. Combined total across all cities: Rs ${total.toLocaleString(
      "en-IN"
    )}. This figure updates automatically every few seconds as new sales are recorded — no manual refresh needed.`,
  };
}

const STOPWORDS = new Set([
  "the","is","are","a","an","of","for","to","in","on","and","what","whats",
  "does","do","how","can","i","you","we","it","this","that","with","was",
  "will","be","my","our","your","their","at","by","from","as","or","if",
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
}

// Lightweight keyword-overlap retriever — a transparent stand-in for a
// vector/embedding search over the same documents in production.
function retrieve(query, docs, topK = 2) {
  const qWords = tokenize(query);
  const scored = docs.map((doc) => {
    const docWords = tokenize(doc.title + " " + doc.content);
    const docSet = new Set(docWords);
    let score = 0;
    qWords.forEach((w) => {
      if (docSet.has(w)) score += 1;
      else if ([...docSet].some((d) => d.includes(w) || w.includes(d))) score += 0.5;
    });
    return { doc, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

const SUGGESTIONS = [
  "What's the sale today?",
  "What's today's rate for Hyderabad?",
  "Is Batch 214 FSSAI certified?",
  "What's the minimum order quantity?",
];

async function generateAnswer(question, sources) {
  const context = sources
    .map((s) => `[${s.doc.title}]\n${s.doc.content}`)
    .join("\n\n");

  const system = sources.length
    ? `You are the SesameAI assistant for a black sesame seed processing and cold-pressed oil distribution company. Answer the distributor/staff question using ONLY the context below. Be direct and concise (2-4 sentences). Mention the specific numbers or steps asked for. If the context does not fully answer it, say what is missing. Never invent facts not in the context.\n\nCONTEXT:\n${context}`
    : `You are the SesameAI assistant for a black sesame seed processing and cold-pressed oil distribution company. No matching internal document was found for this question. Say briefly, in 1-2 sentences, that this isn't in the current knowledge base and suggest who to check with (e.g. head office or the quality team). Do not invent an answer.`;

  // Calls our own serverless function (api/chat.js) instead of Anthropic
  // directly — the API key must stay server-side, and browsers can't call
  // api.anthropic.com directly outside Claude's own sandbox anyway.
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, question }),
    });
    const data = await response.json();
    return data.text || "I couldn't generate a response — please try again.";
  } catch (e) {
    return "Something went wrong reaching the assistant. Please try again.";
  }
}

export default function SesameRAGDemo() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi, I'm SesameAI — ask me anything about pricing, SOPs, certificates, stock or distributor policy. I only answer from the company's own documents.",
      sources: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState(null); // null | "retrieving" | "generating"
  const scrollRef = useRef(null);

  // --- Live data simulation: a POS/ERP feed pushing new sales every few seconds ---
  const [salesByCity, setSalesByCity] = useState({
    Hyderabad: 42500, Vijayawada: 61200, Chennai: 18300, Bengaluru: 27600,
  });
  const [salesUpdatedAt, setSalesUpdatedAt] = useState("just now");
  const [justUpdated, setJustUpdated] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setSalesByCity((prev) => {
        const next = { ...prev };
        const city = CITIES[Math.floor(Math.random() * CITIES.length)];
        next[city] = next[city] + Math.floor(Math.random() * 4000 + 500);
        return next;
      });
      setSalesUpdatedAt(
        new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
      setJustUpdated(true);
      setTimeout(() => setJustUpdated(false), 900);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const salesDoc = buildSalesDoc(salesByCity, salesUpdatedAt);

  // --- Manually "pushed" updates — simulates a new record landing from the
  // source system (a new SOP note, a rate change, a fresh certificate) ---
  const [pushedDocs, setPushedDocs] = useState([]);
  const [pushDraft, setPushDraft] = useState("");

  function pushUpdate() {
    const text = pushDraft.trim();
    if (!text) return;
    setPushedDocs((d) => [
      ...d,
      {
        id: `pushed-${Date.now()}`,
        title: `Update — ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
        icon: Plus,
        content: text,
      },
    ]);
    setPushDraft("");
  }

  const allDocs = [...DOCUMENTS, salesDoc, ...pushedDocs];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, stage]);

  async function handleSend(text) {
    const question = (text ?? input).trim();
    if (!question || stage) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);

    setStage("retrieving");
    await new Promise((r) => setTimeout(r, 550)); // let the retrieval step be visible
    const sources = retrieve(question, allDocs);

    setStage("generating");
    const answer = await generateAnswer(question, sources);

    setStage(null);
    setMessages((m) => [...m, { role: "assistant", text: answer, sources }]);
  }

  return (
    <div className="w-full h-screen flex bg-white text-stone-900">
      {/* Sidebar — knowledge base */}
      <div className="hidden md:flex flex-col w-72 bg-stone-900 text-stone-100 p-5 shrink-0 overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded-full bg-amber-500 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-stone-900" />
          </div>
          <div>
            <div className="font-semibold leading-tight">SesameAI</div>
            <div className="text-xs text-stone-400 leading-tight">Knowledge Assistant</div>
          </div>
        </div>
        <p className="text-xs text-stone-400 mt-4 mb-3 uppercase tracking-wide">
          Connected documents
        </p>
        <div className="flex flex-col gap-2 overflow-y-auto">
          {DOCUMENTS.map((doc) => {
            const Icon = doc.icon;
            return (
              <div
                key={doc.id}
                className="flex items-start gap-3 bg-stone-800 rounded-lg p-3"
              >
                <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-sm text-stone-200 leading-snug">{doc.title}</div>
              </div>
            );
          })}

          {/* Live-updating document — simulates a POS/ERP feed syncing every few seconds */}
          <div
            className={`flex items-start gap-3 rounded-lg p-3 border transition-colors ${
              justUpdated ? "bg-amber-500/10 border-amber-500/50" : "bg-stone-800 border-transparent"
            }`}
          >
            <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center shrink-0">
              <Radio className={`w-4 h-4 text-amber-400 ${justUpdated ? "animate-pulse" : ""}`} />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-stone-200 leading-snug">{salesDoc.title}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">Synced {salesUpdatedAt}</div>
            </div>
          </div>

          {pushedDocs.map((doc) => (
            <div key={doc.id} className="flex items-start gap-3 bg-stone-800 rounded-lg p-3">
              <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center shrink-0">
                <Plus className="w-4 h-4 text-amber-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm text-stone-200 leading-snug">{doc.title}</div>
                <div className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">{doc.content}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Simulates a new record arriving from an outside source system */}
        <div className="mt-4 pt-4 border-t border-stone-800">
          <p className="text-xs text-stone-400 mb-2 uppercase tracking-wide">
            Push a live update
          </p>
          <textarea
            value={pushDraft}
            onChange={(e) => setPushDraft(e.target.value)}
            placeholder="e.g. New batch 215 approved, purity 99.4%…"
            rows={2}
            className="w-full text-xs bg-stone-800 text-stone-200 placeholder-stone-500 rounded-lg p-2 outline-none focus:ring-1 focus:ring-amber-500 resize-none"
          />
          <button
            onClick={pushUpdate}
            disabled={!pushDraft.trim()}
            className="mt-2 w-full text-xs bg-amber-500 text-stone-900 font-medium rounded-lg py-1.5 disabled:opacity-30 hover:bg-amber-400 transition"
          >
            Add to knowledge base
          </button>
        </div>

        <div className="mt-4 text-xs text-stone-500 leading-relaxed">
          The sales feed ticks on its own — like a POS syncing automatically. Try pushing an
          update too, then ask about it: no retraining, the next answer just knows.
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-semibold text-stone-900">Distributor & Staff Assistant</div>
            <div className="text-xs text-stone-500">Answers only from the documents on the left</div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Live
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  m.role === "user" ? "bg-stone-800" : "bg-amber-500"
                }`}
              >
                {m.role === "user" ? (
                  <User className="w-4 h-4 text-white" />
                ) : (
                  <Bot className="w-4 h-4 text-stone-900" />
                )}
              </div>
              <div className={`max-w-xl flex flex-col gap-2 ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-stone-900 text-white"
                      : "bg-stone-100 text-stone-900"
                  }`}
                >
                  {m.text}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.sources.map((s) => (
                      <div
                        key={s.doc.id}
                        className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1"
                      >
                        <FileText className="w-3 h-3" />
                        {s.doc.title}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {stage && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-stone-900" />
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-500 bg-stone-100 rounded-2xl px-4 py-3">
                {stage === "retrieving" ? (
                  <>
                    <Search className="w-4 h-4 animate-pulse" />
                    Searching the knowledge base…
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating answer from retrieved sources…
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => handleSend(q)}
              disabled={!!stage}
              className="text-xs border border-stone-300 text-stone-600 rounded-full px-3 py-1.5 hover:bg-stone-100 disabled:opacity-40 transition"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="border-t border-stone-200 p-4">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask about pricing, SOPs, certificates, stock or policy…"
              className="flex-1 border border-stone-300 rounded-full px-4 py-2.5 text-sm outline-none focus:border-amber-500"
              disabled={!!stage}
            />
            <button
              onClick={() => handleSend()}
              disabled={!!stage || !input.trim()}
              className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center disabled:opacity-40 hover:bg-amber-600 transition shrink-0"
            >
              <Send className="w-4 h-4 text-stone-900" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
