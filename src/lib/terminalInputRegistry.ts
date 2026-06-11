type TerminalInputWriter = (data: string) => void;
type TerminalOutputFlusher = () => Promise<void>;

const writers = new Map<string, TerminalInputWriter>();
const outputFlushers = new Map<string, TerminalOutputFlusher>();

export function registerTerminalInputWriter(sessionId: string, writer: TerminalInputWriter): () => void {
  writers.set(sessionId, writer);
  return () => {
    if (writers.get(sessionId) === writer) writers.delete(sessionId);
  };
}

export function writeRegisteredTerminalInput(sessionId: string, data: string): boolean {
  const writer = writers.get(sessionId);
  if (!writer) return false;
  writer(data);
  return true;
}

export function registerTerminalOutputFlusher(sessionId: string, flusher: TerminalOutputFlusher): () => void {
  outputFlushers.set(sessionId, flusher);
  return () => {
    if (outputFlushers.get(sessionId) === flusher) outputFlushers.delete(sessionId);
  };
}

export async function flushRegisteredTerminalOutput(sessionId: string): Promise<boolean> {
  const flusher = outputFlushers.get(sessionId);
  if (!flusher) return false;
  await flusher();
  return true;
}
