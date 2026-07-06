import { crawlEvents } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          const body = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(body));
        } catch { /* connection closed */ }
      };

      const onUpdate = (payload: unknown) => send("update", payload);
      const onStatus = (payload: unknown) => send("status", payload);

      crawlEvents.on("update", onUpdate);
      crawlEvents.on("status", onStatus);

      // Heartbeat every 15s — also detects client disconnect when enqueue throws
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": hb\n\n")); } catch { cleanup(); }
      }, 15000);

      function cleanup() {
        clearInterval(heartbeat);
        crawlEvents.off("update", onUpdate);
        crawlEvents.off("status", onStatus);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
