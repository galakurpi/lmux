type SampleKey =
  | "inputGapMs"
  | "writeMs"
  | "outputFlushMs"
  | "screenCaptureMs"
  | "eventLoopDriftMs";

interface PerfState {
  startedAt: number;
  inputEvents: number;
  inputBytes: number;
  receivedOutputChunks: number;
  receivedOutputBytes: number;
  outputFlushes: number;
  outputBytes: number;
  hiddenOutputFlushes: number;
  hiddenOutputBytes: number;
  maxQueuedOutputBytes: number;
  samples: Record<SampleKey, number[]>;
  sampleWriteIndex: Record<SampleKey, number>;
  max: Record<SampleKey, number>;
  lastInputAt: number | null;
}

const MAX_SAMPLES = 2000;
const EVENT_LOOP_INTERVAL_MS = 50;
const state = createState();

function createState(): PerfState {
  return {
    startedAt: performance.now(),
    inputEvents: 0,
    inputBytes: 0,
    receivedOutputChunks: 0,
    receivedOutputBytes: 0,
    outputFlushes: 0,
    outputBytes: 0,
    hiddenOutputFlushes: 0,
    hiddenOutputBytes: 0,
    maxQueuedOutputBytes: 0,
    samples: {
      inputGapMs: [],
      writeMs: [],
      outputFlushMs: [],
      screenCaptureMs: [],
      eventLoopDriftMs: [],
    },
    sampleWriteIndex: {
      inputGapMs: 0,
      writeMs: 0,
      outputFlushMs: 0,
      screenCaptureMs: 0,
      eventLoopDriftMs: 0,
    },
    max: {
      inputGapMs: 0,
      writeMs: 0,
      outputFlushMs: 0,
      screenCaptureMs: 0,
      eventLoopDriftMs: 0,
    },
    lastInputAt: null,
  };
}

function pushSample(key: SampleKey, value: number) {
  if (!Number.isFinite(value) || value < 0) return;
  state.max[key] = Math.max(state.max[key], value);
  const samples = state.samples[key];
  if (samples.length < MAX_SAMPLES) {
    samples.push(value);
    return;
  }

  samples[state.sampleWriteIndex[key]] = value;
  state.sampleWriteIndex[key] = (state.sampleWriteIndex[key] + 1) % MAX_SAMPLES;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(values: number[], max: number) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max,
  };
}

let expectedTick = performance.now() + EVENT_LOOP_INTERVAL_MS;
window.setInterval(() => {
  const now = performance.now();
  const drift = now - expectedTick;
  expectedTick = now + EVENT_LOOP_INTERVAL_MS;
  if (drift > 0) pushSample("eventLoopDriftMs", drift);
}, EVENT_LOOP_INTERVAL_MS);

export function resetTerminalPerfStats() {
  Object.assign(state, createState());
  expectedTick = performance.now() + EVENT_LOOP_INTERVAL_MS;
}

export function recordTerminalInput(data: string) {
  const now = performance.now();
  if (state.lastInputAt !== null) {
    pushSample("inputGapMs", now - state.lastInputAt);
  }
  state.lastInputAt = now;
  state.inputEvents += 1;
  state.inputBytes += data.length;
}

export function recordTerminalWriteDuration(durationMs: number) {
  pushSample("writeMs", durationMs);
}

export function recordTerminalOutputChunk(bytes: number) {
  state.receivedOutputChunks += 1;
  state.receivedOutputBytes += bytes;
}

export function recordTerminalOutputFlush(durationMs: number, bytes: number, visibility: "visible" | "hidden" = "visible") {
  state.outputFlushes += 1;
  state.outputBytes += bytes;
  if (visibility === "hidden") {
    state.hiddenOutputFlushes += 1;
    state.hiddenOutputBytes += bytes;
  }
  pushSample("outputFlushMs", durationMs);
}

export function recordTerminalScreenCapture(durationMs: number) {
  pushSample("screenCaptureMs", durationMs);
}

export function recordTerminalQueuedOutputBytes(bytes: number) {
  state.maxQueuedOutputBytes = Math.max(state.maxQueuedOutputBytes, bytes);
}

export function getTerminalPerfStats() {
  return {
    elapsedMs: performance.now() - state.startedAt,
    inputEvents: state.inputEvents,
    inputBytes: state.inputBytes,
    receivedOutputChunks: state.receivedOutputChunks,
    receivedOutputBytes: state.receivedOutputBytes,
    outputFlushes: state.outputFlushes,
    outputBytes: state.outputBytes,
    hiddenOutputFlushes: state.hiddenOutputFlushes,
    hiddenOutputBytes: state.hiddenOutputBytes,
    maxQueuedOutputBytes: state.maxQueuedOutputBytes,
    inputGapMs: summarize(state.samples.inputGapMs, state.max.inputGapMs),
    writeMs: summarize(state.samples.writeMs, state.max.writeMs),
    outputFlushMs: summarize(state.samples.outputFlushMs, state.max.outputFlushMs),
    screenCaptureMs: summarize(state.samples.screenCaptureMs, state.max.screenCaptureMs),
    eventLoopDriftMs: summarize(state.samples.eventLoopDriftMs, state.max.eventLoopDriftMs),
  };
}
