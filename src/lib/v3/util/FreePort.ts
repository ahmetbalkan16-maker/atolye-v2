import { createServer, type AddressInfo } from "node:net";

/**
 * A TCP port nothing listens on, from the operating system, for Remotion's bundle server. Remotion 4.0.538 picked
 * :3000 while the live AYAS app listened there on IPv6 "::" (its own check looks at IPv4 only), then reached the app
 * through "localhost" and failed every render with "Does this look like a foreign page?" (the 2 Nov 2026 update
 * trial). The port is taken on "::", which is dual-stack on Windows, so it is free on IPv4 and IPv6 alike; a machine
 * without IPv6 falls back to 127.0.0.1.
 */
export function freeLocalPort(): Promise<number> {
  const attempt = (host: string) => new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ port: 0, host }, () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
  return attempt("::").catch(() => attempt("127.0.0.1"));
}
