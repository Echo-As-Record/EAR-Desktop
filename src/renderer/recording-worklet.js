class EarPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Int16Array(4000)
    this.used = 0
    this.finished = false
    this.port.onmessage = () => {
      this.finished = true
      this.flush()
      this.port.postMessage('flushed')
    }
  }

  flush() {
    if (!this.used) return
    const data = this.buffer.slice(0, this.used).buffer
    this.port.postMessage(data, [data])
    this.used = 0
  }

  process(inputs) {
    if (this.finished) return false
    const mono = inputs[0]?.[0]
    if (!mono) return true
    for (const value of mono) {
      const sample = Math.max(-1, Math.min(1, value))
      this.buffer[this.used++] = sample < 0 ? sample * 32768 : sample * 32767
      if (this.used === this.buffer.length) this.flush()
    }
    return true
  }
}

registerProcessor('ear-pcm-capture', EarPcmCapture)
