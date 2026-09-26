import { create } from 'zustand';
import { coerceQcFields, db } from '../utils/db';
import { uid } from '../utils/id';
import type { FireLevel } from '../types/processing-method';
import type { ProcessBatch, ProcessDegree, QcReturnRecord, QcStatus } from '../types/process-batch';

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

/** 默认质检员（演示环境固定账号） */
export const QC_OPERATOR = '质检员 · 赵敏';

interface BatchState {
  batches: ProcessBatch[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 班组提交工序记录：新建后直接进入待质检，得率与程度定住 */
  createBatch: (input: BatchInput) => Promise<ProcessBatch>;
  /**
   * 班组修改后重新提交。仅「已退回」批次可改；
   * 提交后重新进入待质检，得率与程度再次定住。
   */
  resubmitBatch: (id: string, patch: Partial<BatchInput>) => Promise<boolean>;
  removeBatch: (id: string) => Promise<void>;
  /** 质检员放行：批次定稿，得率与程度不再能改；仅「待质检」可放行（已退回须先由班组重新提交） */
  releaseBatch: (id: string, qcBy?: string) => Promise<boolean>;
  /**
   * 质检员退回：原因必填（空着不让提交），原因、时间、操作人
   * 追加进 returns 永久留痕；批次回到班组可改状态。
   */
  returnBatch: (id: string, reason: string, qcBy?: string) => Promise<boolean>;
  /** 取一条批次的全部退回留痕（含原因与时间） */
  returnRecordsOf: (id: string) => QcReturnRecord[];
  degreeCount: () => Record<ProcessDegree, number>;
  /** 待质检批次（首页总览与质检员复核名单） */
  pendingQcBatches: () => ProcessBatch[];
  /** 已放行批次（留样登记的唯一来源） */
  releasedBatches: () => ProcessBatch[];
  batchesOfHerb: (herbId: string) => ProcessBatch[];
}

/** 待质检 / 已放行批次的得率与程度不可改；已退回可由班组修改 */
export function isBatchEditable(status: QcStatus): boolean {
  return status === '已退回';
}

/** 只有放行定稿的批次才能登记留样 */
export function isBatchReleasable(status: QcStatus): boolean {
  return status === '已放行';
}

export const useBatchStore = create<BatchState>()((set, get) => ({
  batches: [],
  hydrated: false,

  hydrate: async () => {
    const rows = await db.batches.orderBy('startedAt').reverse().toArray();
    // 兼容从旧版本备份恢复进来的 locked 布尔行：归一化后写回库
    const batches = rows.map((row) =>
      'qcStatus' in row ? row : coerceQcFields(row as Parameters<typeof coerceQcFields>[0]),
    );
    const patched = batches.filter((b, i) => !('qcStatus' in rows[i]));
    if (patched.length > 0) {
      await db.batches.bulkPut(patched);
    }
    set({ batches, hydrated: true });
  },

  createBatch: async (input) => {
    const now = new Date().toISOString();
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
      qcStatus: '待质检',
      submittedAt: now,
      returns: [],
      remark: input.remark?.trim() || undefined,
    };
    await db.batches.put(batch);
    set({ batches: [batch, ...get().batches] });
    return batch;
  },

  resubmitBatch: async (id, patch) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || !isBatchEditable(current.qcStatus)) {
      return false;
    }
    const next: ProcessBatch = {
      ...current,
      ...patch,
      batchNo: patch.batchNo?.trim() ?? current.batchNo,
      operator: patch.operator?.trim() ?? current.operator,
      remark: patch.remark !== undefined ? patch.remark.trim() || undefined : current.remark,
      qcStatus: '待质检',
      submittedAt: new Date().toISOString(),
      releasedAt: undefined,
      qcBy: undefined,
    };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  removeBatch: async (id) => {
    await db.batches.delete(id);
    set({ batches: get().batches.filter((b) => b.id !== id) });
  },

  releaseBatch: async (id, qcBy = QC_OPERATOR) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current || current.qcStatus !== '待质检') {
      return false;
    }
    const next: ProcessBatch = {
      ...current,
      qcStatus: '已放行',
      releasedAt: new Date().toISOString(),
      qcBy,
    };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  returnBatch: async (id, reason, qcBy = QC_OPERATOR) => {
    const trimmed = reason.trim();
    if (!trimmed) {
      return false;
    }
    const current = get().batches.find((b) => b.id === id);
    if (!current || current.qcStatus === '已退回') {
      return false;
    }
    const record: QcReturnRecord = {
      id: uid('qcret'),
      reason: trimmed,
      returnedAt: new Date().toISOString(),
      qcBy,
    };
    const next: ProcessBatch = {
      ...current,
      qcStatus: '已退回',
      releasedAt: undefined,
      qcBy,
      returns: [record, ...current.returns],
    };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  returnRecordsOf: (id) => get().batches.find((b) => b.id === id)?.returns ?? [],

  degreeCount: () => {
    const result: Record<ProcessDegree, number> = { 不及: 0, 适中: 0, 太过: 0 };
    get().batches.forEach((b) => {
      result[b.degree] += 1;
    });
    return result;
  },

  pendingQcBatches: () => get().batches.filter((b) => b.qcStatus === '待质检'),

  releasedBatches: () => get().batches.filter((b) => b.qcStatus === '已放行'),

  batchesOfHerb: (herbId) => get().batches.filter((b) => b.herbId === herbId),
}));
