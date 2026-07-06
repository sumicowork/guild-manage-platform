import { crawlEvents } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch { /* closed */ }
      };

      const onUpdate = (payload: { taskId: string; stats: unknown }) => send("update", JSON.stringify(payload));
      const onStatus = (payload: { taskId: string; status: string }) => send("status", JSON.stringify(payload));

      crawlEvents.on("update", onUpdate);
      crawlEvents.on("status", onStatus);

      // Initial connection confirmation
      send("connected", "{}");

      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": hb\n\n")); } catch { cleanup?.(); }
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        crawlEvents.off("update", onUpdate);
        crawlEvents.off("status", onStatus);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
