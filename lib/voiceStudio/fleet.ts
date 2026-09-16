/**
 * 생성 PC 무리(fleet) — 현황·명령·책 임대를 서버 한 곳에 모은다.
 *
 * 왜 필요한가
 *   음원 생성은 PC 여러 대가 며칠씩 도는 일이다. 지금까지 진행 상황은 각 PC 의 `jobs/*.json`
 *   안에만 있어서, 그 PC 앞에 앉지 않으면 어디까지 왔는지·멈췄는지·무엇이 어긋났는지 알 수 없었다.
 *   보류 절을 서버로 모아 한 화면에서 판단하게 만든 것과 같은 이유로, **진행 상황과 지시도** 모은다.
 *
 * 저장 구조 — 보류 검수와 같은 규칙으로, **쓰는 주체마다 파일을 나눠** 동시 쓰기 충돌을 피한다.
 *   voice-studio/fleet/{토큰id}.json          ← 그 PC 만 쓴다 (하트비트)
 *   voice-studio/commands/{명령id}.json       ← 지시하는 쪽이 쓰고, 받은 PC 가 결과만 덧쓴다
 *   voice-studio/leases/{계획}/{책}.json      ← 임대를 받아 간 PC 가 쓴다(관리자는 고정·회수만)
 *
 * 임대(lease)를 왜 쓰는가
 *   PC 마다 사람이 범위를 나눠 주면, 한 대를 더 붙이거나 한 대가 꺼질 때마다 사람이 다시 나눠야 한다.
 *   그러다 범위가 겹치면 **같은 절을 두 대가 만든다** — GPU 시간이 두 배로 든다.
 *   책 단위로 빌려 가고(HEARTBEAT_STALE_MS 동안 갱신이 없으면 저절로 풀린다) 끝나면 반납한다.
 *   사람은 관리자 화면에서 배분을 보고 고정(pin)·회수할 수 있다 — 자동이되 최종 결정권은 사람에게 둔다.
 */

import crypto from "crypto";
import { studioGetJson, studioList, studioPutJson, studioDelete } from "./r2";

export const FLEET = "voice-studio/fleet/";
export const COMMANDS = "voice-studio/commands/";
export const LEASES = "voice-studio/leases/";

/** 이만큼 하트비트가 없으면 그 PC 는 꺼진 것으로 보고 임대를 회수한다 */
export const HEARTBEAT_STALE_MS = 10 * 60 * 1000;
/** 명령을 이만큼 지나면 목록에서 치운다 */
export const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * 걸린 지 이만큼 지난 명령은 **더는 집어 가지 않는다.**
 * 없으면 며칠 뒤에 켜진 PC 가 묵은 '멈춤'·'다시 켜기' 를 뒤늦게 실행한다.
 */
export const CLAIM_WINDOW_MS = 30 * 60 * 1000;
const MAX_COMMANDS = 300;

export interface FleetBookProgress {
  book: string;
  total: number;
  done: number;
  held: number;
  uploaded: number;
}

/** 한 대가 보고하는 자기 상태 — PC 가 통째로 덮어쓴다 */
export interface FleetPc {
  /** 기기 토큰 id — PC 를 가리키는 이름이자 파일 이름 */
  tokenId: string;
  /** 사람이 알아보는 이름. 기본은 컴퓨터 이름 */
  label: string;
  host: string;
  gpu: string;
  /** 스튜디오 소스 버전(코드 동기화 해시 앞 8자) */
  codeVersion: string;
  voice: string;
  voiceKey: string;
  /** 워커가 돌고 있는가 */
  running: boolean;
  /** 지금 만들고 있는 것 — "창세기 3:14 외 3건 (재시도1)" */
  note: string;
  jobId: string | null;
  jobTitle: string;
  batch: number;
  /** 최근 한 시간 동안 만든 절 수 — 속도 비교와 '멈춰 있는가' 판단에 쓴다 */
  versesPerHour: number;
  queued: number;
  /** 오류로 멈춘 채 남은 작업 수 — 자동 회복이 세 번 해 보고 손을 뗀 것이 여기 남는다 */
  errorJobs: number;
  /**
   * 다시 만들 후보 — 조건별로 {개수, 가장 나쁜 것 몇 절}.
   *
   * 끝음절 값·일치율은 그 PC 의 작업 파일에만 있어 서버가 직접 셀 수 없다. PC 가 세어 보고하고,
   * 사람이 화면에서 보고 눌러야 다시 만들기 요청이 나간다(덮어쓰기는 verse-regen 한 길뿐이다).
   */
  rework: Record<string, ReworkKind>;
  pending: number;
  okTotal: number;
  heldTotal: number;
  uploadedTotal: number;
  books: FleetBookProgress[];
  /** 사람이 함께 쓰는 PC 라 생성이 양보하도록 둔 상태인가 */
  polite: boolean;
  /** 빌려 간 책들 */
  leases: string[];
  lastError: string;
  /** PC 가 찍은 시각(ISO) */
  at: string;
}

export interface ReworkItem {
  ref: string;
  why: string;
  code?: string;
  chapter?: number;
  verse?: number;
}
export interface ReworkKind {
  count: number;
  label: string;
  items: ReworkItem[];
}

export type CommandOp =
  | "queue_books"
  | "queue_replace"
  | "stop"
  | "resume"
  | "set_batch"
  | "delete_job"
  | "regen_refs"
  | "polite"
  | "restart";

export interface FleetCommand {
  id: string;
  /** 받을 PC 의 토큰 id, 또는 "*" = 모든 PC */
  target: string;
  op: CommandOp;
  args: Record<string, unknown>;
  /** 누가 보냈나 — 관리자 이메일 또는 기기 토큰 id */
  by: string;
  createdAt: string;
  status: "pending" | "done" | "failed" | "cancelled";
  /** 집어 간 PC (target 이 "*" 면 여러 대가 각자 집는다 → takenBy 에 쌓인다) */
  takenBy: string[];
  /** 실행을 마치고 결과를 적은 PC */
  doneBy: string[];
  result: string;
  doneAt?: string;
}

export interface BookLease {
  plan: string;
  book: string;
  /** 빌려 간 PC. 비어 있으면 아직 아무도 안 가져갔다 */
  tokenId: string;
  label: string;
  /** 사람이 이 PC 에 고정했다 — 자동 배분이 건드리지 않고, 하트비트가 끊겨도 풀리지 않는다 */
  pinned: boolean;
  /** 이 책을 아무도 가져가지 못하게 막는다(사람이 보류) */
  blocked: boolean;
  state: "taken" | "done";
  at: string;
}

/**
 * 사람이 손봐야 할 것 — 화면 맨 위와 설정 배지가 같은 값을 쓴다.
 *
 * 무엇을 세느냐가 이 기능의 전부다. 지난 사흘간 **실제로 손해가 난 것만** 골랐다:
 *  · 응답 없는 PC — PC3 가 54분을 조용히 멈춰 있었다
 *  · 오류로 선 작업 — 432절이 39분 멈춰 있었다
 *  · 놀고 있는 PC  — 할 일을 안 줘서 노는 것을 아무도 못 알아챈다
 *  · 쌓인 보류 절  — 사람 판단이 밀리면 그 절은 영영 교인에게 안 나간다
 *
 * '괜찮은데 시끄러운' 것은 넣지 않는다. 배지가 늘 켜져 있으면 아무도 안 본다.
 */
export interface Attention {
  /** 합계 — 배지에 찍을 수 : */
  count: number;
  stale: { label: string; tokenId: string; minutes: number }[];
  errors: { label: string; tokenId: string; jobs: number; message: string }[];
  idle: { label: string; tokenId: string }[];
  held: number;
}

/** 보류 절이 이만큼 쌓이면 알린다 — 한두 개는 늘 있다 */
export const HELD_ALERT = 10;

export function attentionOf(pcs: FleetPc[], held: number, now = Date.now()): Attention {
  const a: Attention = { count: 0, stale: [], errors: [], idle: [], held: 0 };
  for (const p of pcs) {
    if (isStale(p, now)) {
      const minutes = Math.round((now - Date.parse(p.at)) / 60000);
      a.stale.push({ label: p.label, tokenId: p.tokenId, minutes });
      continue;                     // 응답이 없으면 나머지 판단은 믿을 수 없다
    }
    if (p.errorJobs > 0) {
      a.errors.push({ label: p.label, tokenId: p.tokenId, jobs: p.errorJobs, message: p.lastError });
    }
    // 살아 있는데 할 일이 없다 — 분담을 못 받았거나 자기 몫을 끝냈다
    if (p.pending === 0 && p.queued === 0) a.idle.push({ label: p.label, tokenId: p.tokenId });
  }
  if (held >= HELD_ALERT) a.held = held;
  a.count = a.stale.length + a.errors.length + a.idle.length + (a.held ? 1 : 0);
  return a;
}

export function commandId(): string {
  return crypto.randomUUID();
}

export function isStale(pc: FleetPc, now = Date.now()): boolean {
  const t = Date.parse(pc.at);
  return !Number.isFinite(t) || now - t > HEARTBEAT_STALE_MS;
}

export async function listPcs(): Promise<FleetPc[]> {
  const keys = await studioList(FLEET);
  const out: FleetPc[] = [];
  for (const k of keys) {
    const pc = await studioGetJson<FleetPc>(k.key);
    if (pc?.tokenId) out.push(pc);
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

export async function putPc(pc: FleetPc): Promise<boolean> {
  return studioPutJson(`${FLEET}${pc.tokenId}.json`, pc);
}

export async function listCommands(): Promise<FleetCommand[]> {
  const keys = await studioList(COMMANDS);
  const out: FleetCommand[] = [];
  for (const k of keys) {
    const c = await studioGetJson<FleetCommand>(k.key);
    if (c?.id) out.push(c);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export async function putCommand(c: FleetCommand): Promise<boolean> {
  return studioPutJson(`${COMMANDS}${c.id}.json`, c);
}

/**
 * 끝난 지 오래된 명령을 치운다. 목록이 길어지면 PC 마다 매번 전부 읽어야 해서,
 * 10초 간격 조회가 R2 요청을 잔뜩 쓰게 된다.
 */
export async function pruneCommands(all: FleetCommand[]): Promise<FleetCommand[]> {
  const now = Date.now();
  const live: FleetCommand[] = [];
  const dead: FleetCommand[] = [];
  for (const c of all) {
    // 걸린 시각으로 잰다 — 모든 PC 대상 명령은 끝나도 pending 으로 남기 때문에(아래 참조),
    // 끝난 시각만 보면 영영 치워지지 않는다.
    const t = Date.parse(c.createdAt);
    if (Number.isFinite(t) && now - t > COMMAND_TTL_MS) dead.push(c);
    else live.push(c);
  }
  // 그래도 너무 많으면 끝난 것부터 더 버린다
  if (live.length > MAX_COMMANDS) {
    const done = live.filter((c) => c.status !== "pending");
    dead.push(...done.slice(MAX_COMMANDS - live.length));
  }
  for (const c of dead) await studioDelete(`${COMMANDS}${c.id}.json`);
  return live.filter((c) => !dead.includes(c));
}

export function leaseKey(plan: string, book: string): string {
  // 책 이름이 한글이라 키에 그대로 쓰면 목록·삭제에서 인코딩 차이로 어긋난다 — 해시로 고정한다
  const h = crypto.createHash("sha1").update(`${plan} ${book}`).digest("hex").slice(0, 16);
  return `${LEASES}${h}.json`;
}

export async function listLeases(): Promise<BookLease[]> {
  const keys = await studioList(LEASES);
  const out: BookLease[] = [];
  for (const k of keys) {
    const l = await studioGetJson<BookLease>(k.key);
    if (l?.book) out.push(l);
  }
  return out;
}

export async function putLease(l: BookLease): Promise<boolean> {
  return studioPutJson(leaseKey(l.plan, l.book), l);
}

/**
 * 그 임대가 아직 살아 있는가 — 빌려 간 PC 의 하트비트가 최근이어야 한다.
 * 끝난 책(done)과 사람이 고정·차단한 책은 언제나 살아 있는 것으로 본다.
 */
export function leaseLive(l: BookLease, pcs: Map<string, FleetPc>, now = Date.now()): boolean {
  if (l.state === "done" || l.pinned || l.blocked) return true;
  const pc = pcs.get(l.tokenId);
  return !!pc && !isStale(pc, now);
}
