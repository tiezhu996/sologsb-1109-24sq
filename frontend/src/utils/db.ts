import Dexie, { type Table } from 'dexie';
import type { HerbMaterial } from '../types/herb-material';
import type { ProcessingMethod } from '../types/processing-method';
import type { ProcessBatch, QcStatus } from '../types/process-batch';
import type { RetainSample } from '../types/retain-sample';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbherbprocess-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

/** v2 及以前的批次行：只有 locked 布尔，没有质检状态机 */
interface LegacyBatchRow extends Partial<ProcessBatch> {
  id: string;
  locked?: boolean;
  lockedAt?: string;
}

/**
 * 把历史批次行（locked 布尔模型）原地归一化为质检状态机模型：
 * - 旧「已解锁且质检员经手」视为已放行；其余一律视为待质检
 * - 提交时间取旧锁定时间，退回记录初始化为空
 * 供 db.version(3) 迁移与 batchStore 装载旧备份时复用。
 */
export function coerceQcFields(row: LegacyBatchRow): ProcessBatch {
  const next = row as ProcessBatch & { locked?: boolean; lockedAt?: string };
  if (next.qcStatus !== '待质检' && next.qcStatus !== '已放行' && next.qcStatus !== '已退回') {
    const released = next.locked === false && Boolean(next.qcBy);
    next.qcStatus = (released ? '已放行' : '待质检') as QcStatus;
    if (released) {
      next.releasedAt = next.releasedAt ?? next.lockedAt ?? next.endedAt;
    }
  }
  next.submittedAt = next.submittedAt ?? next.lockedAt ?? next.startedAt ?? new Date().toISOString();
  next.returns = Array.isArray(next.returns) ? next.returns : [];
  delete next.locked;
  delete next.lockedAt;
  return next;
}

class HerbProcessDB extends Dexie {
  herbs!: Table<HerbMaterial, string>;
  methods!: Table<ProcessingMethod, string>;
  batches!: Table<ProcessBatch, string>;
  samples!: Table<RetainSample, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      herbs: 'id, name, origin, part, batchNo, receivedAt',
      methods: 'id, name, auxiliary, fireLevel',
      batches: 'id, batchNo, herbId, methodId, degree, startedAt',
      samples: 'id, sampleNo, batchId, cabinet, retainedAt',
      meta: 'key',
    });

    // v2：批次表增加 locked 索引（锁定/质检放行查询更快），并回填历史数据的 locked 字段。
    this.version(2)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, name, auxiliary, fireLevel',
        batches: 'id, batchNo, herbId, methodId, degree, startedAt, locked',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('batches')
          .toCollection()
          .modify((row: LegacyBatchRow) => {
            if (typeof row.locked !== 'boolean') {
              row.locked = false;
            }
          });
      });

    // v3：locked 布尔升级为 qcStatus 质检状态机（待质检/已放行/已退回），
    // 退回原因与时间留在 returns 里。升级前请在「导出备份」中导出 JSON。
    this.version(3)
      .stores({
        herbs: 'id, name, origin, part, batchNo, receivedAt',
        methods: 'id, name, auxiliary, fireLevel',
        batches: 'id, batchNo, herbId, methodId, degree, startedAt, qcStatus',
        samples: 'id, sampleNo, batchId, cabinet, retainedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('batches')
          .toCollection()
          .modify((row: LegacyBatchRow) => {
            coerceQcFields(row);
          });
      });
  }
}

export const db = new HerbProcessDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
