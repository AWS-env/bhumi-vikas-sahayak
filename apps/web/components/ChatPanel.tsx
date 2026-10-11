/* Chat look reused from the teammate's ChatPanel (blueprint blue + ivory).
   UI only for now: no messages are sent and no API is called. */

const C = {
  panel: "bg-[#053581] paper-grain",
  inputShell: "border-[#F2E9D0]/25 bg-[#14438A]",
  inputField: "bg-transparent text-[#F2E9D0] placeholder:text-[#F2E9D0]/50",
  sendBtn: "bg-[#F2E9D0] text-[#0A3982]",
  muted: "text-[#F2E9D0]/60",
} as const;

export default function ChatPanel() {
  return (
    <div className={`flex h-full flex-col overflow-hidden ${C.panel}`}>
      <div className="flex-grow-[1.5]" />

      <div className="mx-auto mb-8 flex w-full max-w-3xl shrink-0 flex-col items-center gap-5 px-4">
        <h1 className="text-center text-3xl font-semibold tracking-tight text-[#F2E9D0] sm:text-4xl">
          Bhumi Vikas Sahayak
        </h1>
        <p className={`text-center text-sm ${C.muted}`}>
          Ask about the MP Bhumi Vikas Rules, 2012 — in English or Hindi.
        </p>
      </div>

      <div className="flex-shrink-0 px-4 pb-5 pt-2">
        <div className={`mx-auto max-w-3xl rounded-2xl border px-3 py-3 shadow-lg ${C.inputShell}`}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Ask about the Bhumi Vikas Rules…"
              className={`flex-1 rounded-full border border-transparent px-4 py-2.5 text-sm outline-none transition-all focus:border-[#F2E9D0]/40 ${C.inputField}`}
            />
            <button
              type="button"
              aria-label="Send message"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${C.sendBtn}`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-grow-[1]" />
    </div>
  );
}
