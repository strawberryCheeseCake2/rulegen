// A sandbox made on first use (a hidden sandboxed iframe hosting a worker, see sandboxHost): each request gets its
// own reply. Browser only.

export function sandboxRunner(host: string) {
  let port: Promise<MessagePort> | null = null, next = 0;
  const waiting = new Map<number, (reply: Record<string, unknown>) => void>();
  const connect = () => port ??= new Promise(resolve => {
    const frame = document.createElement("iframe");
    frame.hidden = true; frame.title = "Sandbox"; frame.setAttribute("sandbox", "allow-scripts"); frame.srcdoc = host;
    frame.onload = () => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { const done = waiting.get(event.data?.id); if (done) { waiting.delete(event.data.id); done(event.data); } };
      frame.contentWindow!.postMessage("overlay-port", "*", [channel.port2]);
      resolve(channel.port1);
    };
    document.body.appendChild(frame);
  });
  return {
    async run(message: Record<string, unknown>): Promise<Record<string, unknown>> {
      const channel = await connect(), id = ++next;
      return new Promise(resolve => { waiting.set(id, resolve); channel.postMessage({ ...message, id }); });
    },
  };
}
