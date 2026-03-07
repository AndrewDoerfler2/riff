interface PeakRequestMessage {
  id: number;
  channelData: ArrayBuffer;
  numPoints: number;
}

interface PeakResponseMessage {
  id: number;
  peaks: number[];
}

function computePeaksFromChannelData(data: Float32Array, numPoints: number): number[] {
  const blockSize = Math.max(1, Math.floor(data.length / numPoints));
  const stride = Math.max(1, Math.floor(blockSize / 48));
  const peaks: number[] = [];

  for (let i = 0; i < numPoints; i += 1) {
    let max = 0;
    const start = i * blockSize;
    const end = Math.min(data.length, start + blockSize);
    for (let j = start; j < end; j += stride) {
      const abs = Math.abs(data[j] || 0);
      if (abs > max) max = abs;
    }
    peaks.push(Math.min(1, max));
  }

  return peaks;
}

self.onmessage = (event: MessageEvent<PeakRequestMessage>) => {
  const payload = event.data;
  const peaks = computePeaksFromChannelData(new Float32Array(payload.channelData), payload.numPoints);
  const response: PeakResponseMessage = { id: payload.id, peaks };
  self.postMessage(response);
};
