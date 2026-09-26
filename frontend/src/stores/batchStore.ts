import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { FireLevel } from '../types/processing-method';
import type { ProcessBatch, ProcessDegree, QcLog } from '../types/process-batch';

export interface BatchInput {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  fireLevel: FireLevel;
  startedAt: string;
  endedAt: string;
  yieldRate: number;
  degree: ProcessDegree;
  operator: string;
  remark?: string;
}

interface BatchState {
  batches: ProcessBatch[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 班组提交工序记录：提交即锁定，进入待质检 */
  createBatch: (input: BatchInput) => Promise<ProcessBatch>;
  /** 仅已退回批次可修改；保存后重新锁定并回到待质检 */
  updateBatch: (id: string, patch: Partial<BatchInput>) => Promise<boolean>;
  removeBatch: (id: string) => Promise<void>;
  /** 质检员放行：批次定稿，得率与程度不再可改 */
  releaseBatch: (id: string, qcBy: string) => Promise<boolean>;
  /** 质检员退回：必须填写退回原因，原因与时间留痕 */
  returnBatch: (id: string, qcBy: string, reason: string) => Promise<boolean>;
  degreeCount: () => Record<ProcessDegree, number>;
  /** 待质检批次（班组已提交、待质检员复核） */
  pendingQcBatches: () => ProcessBatch[];
  /** 已放行批次（定稿，可登记留样） */
  releasedBatches: () => ProcessBatch[];
  batchesOfHerb: (herbId: string) => ProcessBatch[];
}

export const useBatchStore = create<BatchState>()((set, get) => ({
  batches: [],
  hydrated: false,

  hydrate: async () => {
    const batches = await db.batches.orderBy('startedAt').reverse().toArray();
    set({ batches, hydrated: true });
  },

  createBatch: async (input) => {
    const batch: ProcessBatch = {
      id: uid('batch'),
      batchNo: input.batchNo.trim(),
      herbId: input.herbId,
      methodId: input.methodId,
      feedKg: Number(input.feedKg) || 0,
      auxUsedKg: Number(input.auxUsedKg) || 0,
      fireLevel: input.fireLevel,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      yieldRate: Number(input.yieldRate) || 0,
      degree: input.degree,
      operator: input.operator.trim(),
      locked: true,
      lockedAt: new Date().toISOString(),
      qcStatus: 'pending',
      qcLogs: [],
      remark: input.remark?.trim() || undefined,
    };
    await db.batches.put(batch);
    set({ batches: [batch, ...get().batches] });
    return batch;
  },

  updateBatch: async (id, patch) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return false;
    }
    if (current.qcStatus !== 'returned') {
      return false;
    }
    const next: ProcessBatch = {
      ...current,
      ...patch,
      locked: true,
      lockedAt: new Date().toISOString(),
      qcStatus: 'pending',
    };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  removeBatch: async (id) => {
    await db.batches.delete(id);
    set({ batches: get().batches.filter((b) => b.id !== id) });
  },

  releaseBatch: async (id, qcBy) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || current.qcStatus !== 'pending') {
      return false;
    }
    const log: QcLog = { id: uid('qc'), action: '放行', qcBy, at: new Date().toISOString() };
    const next: ProcessBatch = {
      ...current,
      locked: true,
      qcStatus: 'released',
      qcBy,
      qcLogs: [...(current.qcLogs ?? []), log],
    };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  returnBatch: async (id, qcBy, reason) => {
    const current = get().batches.find((b) => b.id === id);
    const trimmed = reason.trim();
    if (!current || current.qcStatus === 'returned' || !trimmed) {
      return false;
    }
    const log: QcLog = { id: uid('qc'), action: '退回', qcBy, at: new Date().toISOString(), reason: trimmed };
    const next: ProcessBatch = {
      ...current,
      locked: false,
      qcStatus: 'returned',
      qcBy,
      qcLogs: [...(current.qcLogs ?? []), log],
    };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  degreeCount: () => {
    const result: Record<ProcessDegree, number> = { 不及: 0, 适中: 0, 太过: 0 };
    get().batches.forEach((b) => {
      result[b.degree] += 1;
    });
    return result;
  },

  pendingQcBatches: () => get().batches.filter((b) => b.qcStatus === 'pending'),

  releasedBatches: () => get().batches.filter((b) => b.qcStatus === 'released'),

  batchesOfHerb: (herbId) => get().batches.filter((b) => b.herbId === herbId),
}));
