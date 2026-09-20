"use client";

/**
 * 성경 질문 — 말로 묻기(녹음 → 글)
 *
 * 글을 잘 못 쓰시는 어르신도 물을 수 있어야 한다.
 * 받은 글은 **입력창에 넣어 보여 준 뒤** 센 다음에 보낸다(§B-13, 지휘부 2026-09-21).
 * 잘못 들었을 때 고칠 수 있어야 하고, 무엇이 외부로 나가는지 눈으로 보고 있어야 한다 —
 * 셈이 도는 동안 '잠깐, 고칠게요' 를 누르거나 입력창을 건드리면 멈춘다.
 *
 * 이 저장소에 MediaRecorder 선례가 없어 여기서 처음 쓴다. 지켜야 할 것:
 *  - 마이크 트랙을 **반드시 멈춘다**. 안 그러면 탭에 녹음 표시가 남아 교인이 불안해한다
 *  - 길이에 상한을 둔다. 게이트웨이가 10MB 를 넘으면 받지 않는다
 *  - 권한 거절·미지원을 따로 말해 준다("안 된다" 만으로는 무엇을 할지 모른다)
 *
 * **말이 끊기면 스스로 마감한다**(지휘부 2026-09-21). 말을 마치고 화면에서 단추를 찾아 누르는
 * 그 멈칫거림이 그대로 녹음에 들어갔다. 세 가지를 함께 지켜야 실제로 쓸 만하다:
 *  1. 문턱값을 **고정하지 않는다** — 거실·교회 소음이 고정 문턱을 넘으면 영영 안 끝나고 상한까지 간다.
 *     시작 0.6초로 바닥 소음을 재서 거기에 여유를 얹고, 그마저 시끄러우면 자동 마감을 **끈다**(`noisy`)
 *  2. **말을 한 번이라도 들은 뒤**부터 침묵을 센다. 안 그러면 마이크를 켜고 생각하는 동안 끝나 버린다
 *  3. 아무 말도 못 들은 채 `NO_SPEECH_SECONDS` 가 지나면 끝낸다 — 90초 동안 켜 두지 않는다
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** 녹음 상한. webm opus 가 대략 초당 4KB 안쪽이라 10MB 한도에서 한참 남는다. */
const MAX_SECONDS = 90;

/** 말이 끊기고 이만큼이면 마감(지휘부 2026-09-21). 2.5초는 짧고 5초는 기다리다 단추를 누르게 된다. */
const SILENCE_MS = 3500;
/** 마지막 이만큼은 화면에 셈을 보여 준다 — 보고 있으면 더 말할 사람이 말을 이어 시계를 되돌린다. */
const COUNTDOWN_MS = 2000;
/** 한 마디도 못 들은 채 이만큼이면 끝낸다. */
const NO_SPEECH_SECONDS = 12;
/** 바닥 소음을 재는 시간. 이 동안은 아무것도 판정하지 않는다. */
const CALIBRATE_MS = 600;
/** 바닥 소음이 이보다 크면 말과 소음을 가를 수 없다 → 자동 마감을 끈다. */
const NOISY_FLOOR = 0.05;
/** 말로 치는 문턱 = 바닥 소음 × 배수, 단 최소값 아래로는 내려가지 않는다. */
const SPEECH_OVER_FLOOR = 2.2;
const MIN_SPEECH_LEVEL = 0.012;

export type VoiceState = "idle" | "recording" | "sending";

export interface UseQaVoiceInput {
  state: VoiceState;
  /** 녹음 중 경과 초 */
  seconds: number;
  /** 자동 마감까지 남은 초(3·2·1). 셈이 돌지 않을 때는 null */
  countdown: number | null;
  /** 주변이 시끄러워 자동 마감을 껐다 — 화면이 '다 말하시면 눌러 주세요' 로 바꾼다 */
  noisy: boolean;
  supported: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  clearError: () => void;
}

export function useQaVoiceInput(onText: (text: string) => void): UseQaVoiceInput {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [noisy, setNoisy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  // ── 침묵 감지 ──────────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  /** 마지막으로 말이 들린 시각. 0 이면 아직 한 마디도 못 들었다 */
  const lastSpeechRef = useRef(0);
  /** 아무 말도 못 들은 채 끝났는가 — 끝난 이유를 화면에 다르게 적는다 */
  const noSpeechRef = useRef(false);
  /**
   * 지금 소리를 지켜보고 있는가. 소리를 못 재거나(구형 브라우저) 주변이 시끄러워 자동 마감을 껐으면 false 다.
   * **이 값을 안 보면 조용히 망가진다** — 지켜보지 않는 동안은 '말이 들린 적 없음' 이 계속 참이라,
   * 열심히 말하고 있는데도 '한 마디도 못 들었다' 며 녹음을 끊어 버린다.
   */
  const watchingRef = useRef(false);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof window.MediaRecorder !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  /** 마이크를 놓아 준다. 어느 길로 끝나든 여기를 지나야 한다. */
  const release = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // AudioContext 는 탭마다 개수 제한이 있다 — 안 닫으면 몇 번 쓰고 나서 녹음이 안 켜진다.
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    watchingRef.current = false;
    setCountdown(null);
  }, []);

  /**
   * 음량을 지켜보다 말이 끊기면 녹음을 멈춘다.
   * 소리 크기는 RMS(제곱평균)로 잰다 — 최댓값만 보면 문 닫히는 소리 한 번에 말로 친다.
   */
  const watchSilence = useCallback((stream: MediaStream) => {
    watchingRef.current = false;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return; // 소리를 못 재면 자동 마감만 없고 녹음은 그대로 된다
    }
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const startedAt = performance.now();
    let floor = 0;
    let floorSamples = 0;
    let threshold = MIN_SPEECH_LEVEL;
    lastSpeechRef.current = 0;
    noSpeechRef.current = false;

    const tick = () => {
      rafRef.current = window.requestAnimationFrame(tick);
      if (recorderRef.current?.state !== "recording") return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const level = Math.sqrt(sum / buf.length);
      const elapsed = performance.now() - startedAt;

      // 1) 바닥 소음 재기 — 이 동안은 판정하지 않는다
      if (elapsed < CALIBRATE_MS) {
        floor += level;
        floorSamples++;
        return;
      }
      if (floorSamples > 0) {
        floor = floor / floorSamples;
        floorSamples = 0;
        if (floor > NOISY_FLOOR) {
          // 말과 소음을 가를 수 없다 — 자동 마감을 끄고 사람이 누르게 둔다
          watchingRef.current = false;
          setNoisy(true);
          if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          return;
        }
        threshold = Math.max(floor * SPEECH_OVER_FLOOR, MIN_SPEECH_LEVEL);
        watchingRef.current = true;
      }

      const now = performance.now();
      if (level > threshold) {
        lastSpeechRef.current = now;
        setCountdown(null);
        return;
      }

      // 2) 아직 한 마디도 못 들었으면 침묵을 세지 않는다(생각하는 시간)
      if (lastSpeechRef.current === 0) return;

      // 3) 말이 끊긴 뒤 — 마지막 몇 초는 셈을 보여 준다
      const quiet = now - lastSpeechRef.current;
      if (quiet >= SILENCE_MS) {
        setCountdown(null);
        recorderRef.current?.stop();
        return;
      }
      if (quiet >= SILENCE_MS - COUNTDOWN_MS) {
        setCountdown(Math.max(1, Math.ceil((SILENCE_MS - quiet) / 1000)));
      }
    };
    rafRef.current = window.requestAnimationFrame(tick);
  }, []);

  // 창이 닫히면 녹음도 끝난다 — 트랙이 남으면 탭에 녹음 표시가 계속 켜져 있다.
  useEffect(() => () => release(), [release]);

  const send = useCallback(
    async (blob: Blob) => {
      setState("sending");
      try {
        const form = new FormData();
        // 파일 이름을 webm 으로 못 박으면 **아이폰에서 실패한다** — 사파리는 webm 이 아니라 mp4 로 녹음한다.
        // whisper 는 확장자를 보고 포맷을 가르므로, 실제 mimeType 에서 뽑아 붙인다(2026-09-21).
        const ext = (blob.type.split(";")[0].split("/")[1] || "webm").replace("x-", "");
        form.append("file", blob, `question.${ext}`);
        const res = await fetch("/api/bible-qa/stt", { method: "POST", body: form });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.text) {
          setError(json.error || "말씀을 글로 바꾸지 못했습니다.");
          return;
        }
        onText(String(json.text));
      } catch {
        setError("연결이 끊겼습니다. 다시 시도해 주세요.");
      } finally {
        setState("idle");
        setSeconds(0);
      }
    },
    [onText],
  );

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setError(null);
    cancelledRef.current = false;
    if (!supported) {
      setError("이 기기에서는 녹음을 쓸 수 없습니다. 글로 적어 주세요.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // 권한 거절과 마이크 없음을 가르지 못한다(브라우저가 같은 오류를 준다).
      setError("마이크를 쓸 수 없습니다. 브라우저에서 마이크 권한을 허용해 주세요.");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      release();
      setError("이 기기에서는 녹음을 쓸 수 없습니다. 글로 적어 주세요.");
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      const cancelled = cancelledRef.current;
      const noSpeech = noSpeechRef.current;
      release();
      if (cancelled) {
        setState("idle");
        setSeconds(0);
        return;
      }
      // 한 마디도 못 들은 채 끝났으면 게이트웨이까지 보내지 않는다 — 빈 녹음에 값을 치를 이유가 없다.
      if (noSpeech || blob.size === 0) {
        setState("idle");
        setSeconds(0);
        setError("들리지 않았습니다. 다시 말씀해 주세요.");
        return;
      }
      void send(blob);
    };

    recorder.start();
    setState("recording");
    setSeconds(0);
    setCountdown(null);
    setNoisy(false);
    watchSilence(stream);
    tickRef.current = window.setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        // 상한에 닿으면 스스로 멈춘다 — 길면 게이트웨이가 받지 않는다.
        if (next >= MAX_SECONDS && recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
        // 한 마디도 못 들은 채 오래 켜 두지 않는다(마이크만 켜고 잊은 경우).
        if (
          next >= NO_SPEECH_SECONDS &&
          watchingRef.current &&
          lastSpeechRef.current === 0 &&
          recorderRef.current?.state === "recording"
        ) {
          noSpeechRef.current = true;
          recorderRef.current.stop();
        }
        return next;
      });
    }, 1000);
  }, [state, supported, release, send, watchSilence]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      cancelledRef.current = false;
      recorderRef.current.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      cancelledRef.current = true;
      recorderRef.current.stop();
    } else {
      release();
      setState("idle");
      setSeconds(0);
    }
  }, [release]);

  const clearError = useCallback(() => setError(null), []);

  return { state, seconds, countdown, noisy, supported, error, start, stop, cancel, clearError };
}
