"use client";

/**
 * 성경 질문 — 말로 묻기(녹음 → 글)
 *
 * 글을 잘 못 쓰시는 어르신도 물을 수 있어야 한다.
 * 받은 글은 **바로 보내지 않고 입력창에 넣는다** — 잘못 들었을 때 고칠 수 있어야 하고,
 * 무엇이 외부로 나가는지 보고 누를 수 있어야 한다(docs/BIBLE_QA_DOCTRINE.md §B-7).
 *
 * 이 저장소에 MediaRecorder 선례가 없어 여기서 처음 쓴다. 지켜야 할 것:
 *  - 마이크 트랙을 **반드시 멈춘다**. 안 그러면 탭에 녹음 표시가 남아 교인이 불안해한다
 *  - 길이에 상한을 둔다. 게이트웨이가 10MB 를 넘으면 받지 않는다
 *  - 권한 거절·미지원을 따로 말해 준다("안 된다" 만으로는 무엇을 할지 모른다)
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** 녹음 상한. webm opus 가 대략 초당 4KB 안쪽이라 10MB 한도에서 한참 남는다. */
const MAX_SECONDS = 90;

export type VoiceState = "idle" | "recording" | "sending";

export interface UseQaVoiceInput {
  state: VoiceState;
  /** 녹음 중 경과 초 */
  seconds: number;
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
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // 창이 닫히면 녹음도 끝난다 — 트랙이 남으면 탭에 녹음 표시가 계속 켜져 있다.
  useEffect(() => () => release(), [release]);

  const send = useCallback(
    async (blob: Blob) => {
      setState("sending");
      try {
        const form = new FormData();
        form.append("file", blob, "question.webm");
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
      release();
      if (cancelled) {
        setState("idle");
        setSeconds(0);
        return;
      }
      if (blob.size === 0) {
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
    tickRef.current = window.setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        // 상한에 닿으면 스스로 멈춘다 — 길면 게이트웨이가 받지 않는다.
        if (next >= MAX_SECONDS && recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
        return next;
      });
    }, 1000);
  }, [state, supported, release, send]);

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

  return { state, seconds, supported, error, start, stop, cancel, clearError };
}
