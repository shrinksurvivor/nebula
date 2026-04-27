/**
 * AudioManager handles low-level PCM audio capture and playback for the Live API.
 */
export class AudioManager {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;

  // For playback
  private nextStartTime: number = 0;
  private sampleRate: number = 24000; // Output rate for Gemini Live usually 24k

  constructor() {}

  async startCapture(onAudioData: (base64: string) => void) {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 16000,
    });
    
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    
    // Using ScriptProcessor for simplicity in this environment, though deprecated
    this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
    
    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      // Convert Float32 to Int16
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
      }
      const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
      onAudioData(base64);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  stopCapture() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.processor?.disconnect();
    this.source?.disconnect();
    this.audioContext?.close();
    this.audioContext = null;
  }

  playPcmChunk(base64: string) {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
    }
    
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 0x7FFF;
    }

    const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime;
    }
    
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  resetPlayback() {
    this.nextStartTime = 0;
  }
}
