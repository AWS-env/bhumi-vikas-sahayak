import ChatPanel from "@/components/ChatPanel";

export const metadata = {
  title: "Chat — Bhumi Vikas Sahayak",
  description: "Ask the MP Bhumi Vikas Rules, 2012 in English or Hindi.",
};

export default function ChatPage() {
  return (
    <main className="h-dvh w-full bg-[#032151] paper-grain">
      <ChatPanel />
    </main>
  );
}
