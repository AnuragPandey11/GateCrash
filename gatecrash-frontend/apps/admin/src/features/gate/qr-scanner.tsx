import jsQR from 'jsqr';
import { Camera, ImageUp, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A GateCrash pass QR carries the pass's token; accept it bare or embedded in a link. */
export function extractPassToken(text: string): string | null {
  return text.match(UUID_PATTERN)?.[0]?.toLowerCase() ?? null;
}

/**
 * Reads a pass QR two ways, because gates are messy:
 *
 *  1. **Live camera** (`getUserMedia`) — instant, but browsers only allow it on https or localhost.
 *  2. **Take a photo** (`<input capture>`) — works on any phone over plain http, which is how a
 *     guard's phone on the society Wi-Fi will usually reach a self-hosted server.
 *
 * Both decode with jsQR in the page; nothing leaves the device but the token.
 */
export function QrScanner({ onToken }: { onToken: (token: string) => void }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'idle' | 'camera' | 'decoding'>('idle');
  const [error, setError] = useState<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const cameraAvailable = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
          const token = code ? extractPassToken(code.data) : null;
          if (token) {
            stopped = true;
            onTokenRef.current(token);
            return;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        frame = requestAnimationFrame(tick);
      })
      .catch(() => {
        setError(t('portal.scan.cameraBlocked'));
        setMode('idle');
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [mode, t]);

  const decodeFile = async (file: File) => {
    setMode('decoding');
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      // Phones take 12-megapixel photos; a QR decodes fine, and far faster, at a fraction of that.
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height);
      const token = code ? extractPassToken(code.data) : null;
      if (token) onTokenRef.current(token);
      else setError(t('portal.scan.noCode'));
    } catch {
      setError(t('portal.scan.noCode'));
    } finally {
      setMode('idle');
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-[hsl(230_20%_8%)]">
        {mode === 'camera' ? (
          <>
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            {/* The aiming square: where to hold the code. */}
            <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white/80">
            {mode === 'decoding' ? (
              <Loader2 className="size-8 animate-spin" aria-hidden />
            ) : (
              <Camera className="size-10" aria-hidden />
            )}
            <p className="text-sm">{t('portal.scan.hint')}</p>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {cameraAvailable ? (
          <Button
            type="button"
            size="lg"
            variant={mode === 'camera' ? 'secondary' : 'primary'}
            onClick={() => {
              setError(null);
              setMode(mode === 'camera' ? 'idle' : 'camera');
            }}
          >
            <Camera aria-hidden />
            {mode === 'camera' ? t('portal.scan.stopCamera') : t('portal.scan.startCamera')}
          </Button>
        ) : null}
        <Button type="button" size="lg" variant="secondary" asChild>
          <label className="cursor-pointer">
            <ImageUp aria-hidden />
            {t('portal.scan.takePhoto')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void decodeFile(file);
              }}
            />
          </label>
        </Button>
      </div>
    </div>
  );
}
