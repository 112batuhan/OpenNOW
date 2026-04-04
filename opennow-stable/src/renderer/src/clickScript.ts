import { Dispatch, RefObject, SetStateAction } from "react";
import { GfnWebRtcClient } from "./gfn/webrtcClient";
import type { Worker, RecognizeResult, Word } from "tesseract.js";

type OCRPoint = { x: number; y: number };
type OCRResult = { text: string; center: OCRPoint };

export class GfnAutomation {
  constructor(
    private clientRef: RefObject<GfnWebRtcClient | null>,
    private videoRef: RefObject<HTMLVideoElement | null>,
    private canvasRef: RefObject<HTMLCanvasElement | null>,
    private ctxRef: RefObject<CanvasRenderingContext2D | null>,
    private workerRef: RefObject<Worker | null>,
    private setDebugState: Dispatch<SetStateAction<string | null>>,
    private signal?: AbortSignal,
  ) {}

  // --- Utility Methods ---

  private async sleep(ms: number) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      // If the signal aborts during a sleep, clear timeout and reject
      this.signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("Aborted"));
      });
    });
  }

  private checkAbort() {
    if (this.signal?.aborted) {
      throw new Error("Aborted");
    }
  }

  private debug(message: string) {
    this.setDebugState(message);
    console.log(`[GfnAutomation]: ${message}`);
  }

  private async clickLoop(duration: number, interval: number) {
    const start = Date.now();
    while (Date.now() - start < duration) {
      this.checkAbort();
      this.clientRef.current?.sendMouseClick();
      await this.sleep(interval);
    }
  }

  private async moveCursor(x: number, y: number) {
    this.clientRef.current?.sendMouseMovement(-10000, -10000); // Reset
    await this.sleep(150);
    this.clientRef.current?.sendMouseMovement(x, y);
  }

  // --- OCR Logic ---

  public async findText(targetText: string) {
    const video = this.videoRef.current;
    const canvas = this.canvasRef.current;
    const worker = this.workerRef.current;
    const ctx = this.ctxRef.current;

    if (!video || !canvas || !ctx || !worker || video.videoWidth === 0)
      return null;

    await new Promise<void>((resolve) =>
      video.requestVideoFrameCallback(() => resolve()),
    );

    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.drawImage(video, 0, 0);
    const result: RecognizeResult = await worker.recognize(canvas);
    console.log(result);
    const words = result.data.blocks?.map((word) => ({
      text: word.text,
      boundingBox: {
        x0: word.bbox.x0,
        y0: word.bbox.y0,
        x1: word.bbox.x1,
        y1: word.bbox.y1,
      },
    }));

    console.log(words);
  }

  // --- Main Script ---

  public async runServerLogin() {
    try {
      this.debug("Waiting for Epic Games to Load");
      await this.sleep(20000);

      this.debug("Opening Store");
      await this.moveCursor(230, 180);
      await this.sleep(150);
      this.clientRef.current?.sendMouseClick();

      this.debug("Waiting for store to load");
      await this.sleep(20000);

      await this.findText("hell let loose");

      this.debug("Clicking on Hell Let Loose");
      await this.moveCursor(225, 487);
      await this.sleep(150);
      await this.clickLoop(5000, 1000);

      this.debug("Launching game (90s wait)");
      await this.moveCursor(10, 10);
      await this.clickLoop(90000, 3000);

      this.debug("Clicking on Enlist");
      await this.moveCursor(81, 307);
      await this.sleep(150);
      this.clientRef.current?.sendMouseClick();

      await this.sleep(5000);

      this.debug("Searching for server");
      await this.moveCursor(650, 135);
      await this.sleep(150);
      this.clientRef.current?.sendMouseClick();

      const serverName = "turksletloose.com";
      await this.sleep(2000);
      this.clientRef.current?.sendText(serverName);

      await this.sleep(20000);

      this.debug("Joining first server result");
      await this.moveCursor(170, 180);
      await this.sleep(150);
      await this.clickLoop(2000, 100);

      await this.sleep(20000);

      // Team Selection Logic
      const leftX = 300;
      const rightX = 900;
      const firstTryX = Math.random() > 0.5 ? leftX : rightX;
      const secondTryX = firstTryX === leftX ? rightX : leftX;

      for (const x of [firstTryX, secondTryX, firstTryX, secondTryX]) {
        this.debug(`Joining team at x: ${x}`);
        await this.moveCursor(x, 400);
        await this.sleep(150);
        await this.clickLoop(10000, 1000);
      }
    } catch (e: any) {
      if (e.message === "Aborted") {
        this.debug("Script stopped by user.");
      } else {
        throw e;
      }
    }
    this.debug("Done");
  }
}
