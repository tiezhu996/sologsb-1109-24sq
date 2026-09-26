import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Timeline, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import FilterBar from '../components/common/FilterBar';
import FireLevelTag from '../components/common/FireLevelTag';
import RatioCalculator from '../components/common/RatioCalculator';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHerbFilter } from '../hooks/useHerbFilter';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { HERB_ORIGINS, HERB_PARTS } from '../types/herb-material';
import { FIRE_LEVELS, type FireLevel } from '../types/processing-method';
import { PROCESS_DEGREES, QC_STATUS_LABEL, type ProcessBatch, type ProcessDegree, type QcStatus } from '../types/process-batch';
import { DEGREE_RULES, formatDateTime, judgeDegree, suggestedValues } from '../utils/degree';

const { Title, Paragraph, Text } = Typography;

/** 质检员（演示环境固定） */
const QC_NAME = '质检员 · 赵敏';

const QC_STATUS_OPTIONS = Object.values(QC_STATUS_LABEL);

const QC_STATUS_COLOR: Record<QcStatus, string> = { pending: 'gold', released: 'green', returned: 'orange' };

function statusOfLabel(label: string): QcStatus | '' {
  const hit = (Object.entries(QC_STATUS_LABEL) as Array<[QcStatus, string]>).find(([, v]) => v === label);
  return hit ? hit[0] : '';
}

interface BatchFormValues {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  outputKg: number;
  fireLevel: FireLevel;
  temp: number;
  duration: number;
  startedAt: Dayjs;
  endedAt: Dayjs;
  operator: string;
  degree: ProcessDegree;
  remark?: string;
}

interface ReturnFormValues {
  reason: string;
}

const DEGREE_COLOR: Record<ProcessDegree, string> = { 不及: 'orange', 适中: 'green', 太过: 'red' };

/** 最近一次退回记录（编辑退回批次时提示原因） */
function lastReturnOf(batch: ProcessBatch) {
  return [...(batch.qcLogs ?? [])].reverse().find((log) => log.action === '退回');
}

/** 工序记录台：选方法自动带出辅料比例、火候与判断标准，录入火候与得率 */
export default function BatchBoard() {
  const { message } = AntApp.useApp();
  const herbs = useHerbStore((s) => s.herbs);
  const methods = useMethodStore((s) => s.methods);
  const batches = useBatchStore((s) => s.batches);
  const createBatch = useBatchStore((s) => s.createBatch);
  const updateBatch = useBatchStore((s) => s.updateBatch);
  const releaseBatch = useBatchStore((s) => s.releaseBatch);
  const returnBatch = useBatchStore((s) => s.returnBatch);
  const removeBatch = useBatchStore((s) => s.removeBatch);

  const herbFilter = useHerbFilter();
  const [params] = useSearchParams();
  const degreeParam = params.get('degree') ?? '';
  const qcParam = params.get('qc') ?? '';

  const [form] = Form.useForm<BatchFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessBatch | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [returnTarget, setReturnTarget] = useState<ProcessBatch | null>(null);
  const [returnForm] = Form.useForm<ReturnFormValues>();
  const [logsTarget, setLogsTarget] = useState<ProcessBatch | null>(null);

  const watched = Form.useWatch([], form) as Partial<BatchFormValues> | undefined;
  const watchedMethod = methods.find((m) => m.id === (watched?.methodId ?? ''));
  const watchedYieldRate = useMemo(() => {
    const feed = Number(watched?.feedKg) || 0;
    const out = Number(watched?.outputKg) || 0;
    if (feed <= 0) return 0;
    return Number(((out / feed) * 100).toFixed(1));
  }, [watched?.feedKg, watched?.outputKg]);

  const verdict = useMemo(() => {
    if (!watchedMethod) return undefined;
    return judgeDegree({
      method: watchedMethod,
      fireLevel: (watched?.fireLevel ?? watchedMethod.fireLevel) as FireLevel,
      duration: Number(watched?.duration) || watchedMethod.duration,
      temp: Number(watched?.temp) || Math.round((watchedMethod.tempRange[0] + watchedMethod.tempRange[1]) / 2),
      yieldRate: watchedYieldRate,
    });
  }, [watchedMethod, watched?.fireLevel, watched?.duration, watched?.temp, watchedYieldRate]);

  const visibleHerbs = useMemo(() => herbFilter.apply(herbs), [herbs, herbFilter]);
  const visibleBatches = useMemo(() => {
    const ids = new Set(visibleHerbs.map((h) => h.id));
    const qcStatus = statusOfLabel(qcParam);
    return batches.filter((b) => {
      if (!ids.has(b.herbId)) return false;
      if (degreeParam && b.degree !== degreeParam) return false;
      if (qcStatus && b.qcStatus !== qcStatus) return false;
      return true;
    });
  }, [batches, visibleHerbs, degreeParam, qcParam]);

  const herbName = (id: string) => herbs.find((h) => h.id === id)?.name ?? '未知药材';
  const methodOf = (id: string) => methods.find((m) => m.id === id);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    const firstHerb = herbs[0];
    const firstMethod = methods[0];
    const now = dayjs();
    const base: Partial<BatchFormValues> = {
      batchNo: `PZ-${dayjs().format('YYMMDD')}-${String(batches.length + 1).padStart(2, '0')}`,
      herbId: firstHerb?.id,
      methodId: firstMethod?.id,
      feedKg: firstHerb?.feedKg ?? 100,
      outputKg: Number((((firstHerb?.feedKg ?? 100) * 0.94)).toFixed(1)),
      auxUsedKg: Number((((firstHerb?.feedKg ?? 100) * (firstMethod?.auxRatio ?? 0)) / 100).toFixed(2)),
      fireLevel: firstMethod?.fireLevel ?? '文火',
      temp: firstMethod ? Math.round((firstMethod.tempRange[0] + firstMethod.tempRange[1]) / 2) : 100,
      duration: firstMethod?.duration ?? 12,
      startedAt: now.subtract(20, 'minute'),
      endedAt: now,
      operator: '陈玉兰',
      degree: '适中',
    };
    form.setFieldsValue(base as unknown as BatchFormValues);
    setOpen(true);
  };

  const openEdit = (record: ProcessBatch) => {
    setEditing(record);
    form.resetFields();
    const suggested = methodOf(record.methodId);
    form.setFieldsValue({
      batchNo: record.batchNo,
      herbId: record.herbId,
      methodId: record.methodId,
      feedKg: record.feedKg,
      auxUsedKg: record.auxUsedKg,
      outputKg: Number(((record.feedKg * record.yieldRate) / 100).toFixed(1)),
      fireLevel: record.fireLevel,
      temp: suggested ? Math.round((suggested.tempRange[0] + suggested.tempRange[1]) / 2) : 100,
      duration: suggested?.duration ?? 12,
      startedAt: dayjs(record.startedAt),
      endedAt: dayjs(record.endedAt),
      operator: record.operator,
      degree: record.degree,
      remark: record.remark,
    } as unknown as BatchFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const outputKg = Number(values.outputKg) || 0;
    const feedKg = Number(values.feedKg) || 0;
    if (feedKg <= 0) {
      message.error('投料量必须大于 0');
      return;
    }
    const yieldRate = Number(((outputKg / feedKg) * 100).toFixed(1));
    const payload = {
      batchNo: values.batchNo,
      herbId: values.herbId,
      methodId: values.methodId,
      feedKg,
      auxUsedKg: Number(values.auxUsedKg) || 0,
      fireLevel: values.fireLevel,
      startedAt: values.startedAt.toISOString(),
      endedAt: values.endedAt.toISOString(),
      yieldRate,
      degree: values.degree,
      operator: values.operator,
      remark: values.remark,
    };
    if (editing) {
      const ok = await updateBatch(editing.id, payload);
      if (!ok) {
        message.error('仅已退回的批次可修改；已放行批次需先由质检员退回');
        return;
      }
      message.success(`已重新提交 ${payload.batchNo}，得率 ${yieldRate}%，等待质检复核`);
    } else {
      await createBatch(payload);
      message.success(`已提交 ${payload.batchNo}，得率 ${yieldRate}%，进入待质检`);
    }
    setOpen(false);
  };

  const openReturn = (record: ProcessBatch) => {
    setReturnTarget(record);
    returnForm.resetFields();
  };

  const submitReturn = async () => {
    if (!returnTarget) return;
    const values = await returnForm.validateFields();
    const ok = await returnBatch(returnTarget.id, QC_NAME, values.reason);
    if (!ok) {
      message.error('退回失败：退回原因不能为空');
      return;
    }
    message.success(`已退回 ${returnTarget.batchNo}，退回原因与时间已留痕`);
    setReturnTarget(null);
  };

  const editingReturn = editing ? lastReturnOf(editing) : undefined;

  const columns: TableColumnsType<ProcessBatch> = [
    { title: '生产批号', dataIndex: 'batchNo', width: 130, render: (v: string) => <Text strong>{v}</Text> },
    { title: '药材', dataIndex: 'herbId', width: 90, render: (id: string) => herbName(id) },
    { title: '方法', dataIndex: 'methodId', width: 90, render: (id: string) => methodOf(id)?.name ?? '-' },
    {
      title: '火候',
      dataIndex: 'fireLevel',
      width: 180,
      render: (v: FireLevel, record) => <FireLevelTag level={v} tempRange={methodOf(record.methodId)?.tempRange} duration={methodOf(record.methodId)?.duration} />,
    },
    { title: '投料(kg)', dataIndex: 'feedKg', width: 90, align: 'right' },
    { title: '辅料(kg)', dataIndex: 'auxUsedKg', width: 90, align: 'right' },
    { title: '得率(%)', dataIndex: 'yieldRate', width: 90, align: 'right', render: (v: number) => <Text type={v < 85 ? 'danger' : undefined}>{v}</Text> },
    { title: '程度', dataIndex: 'degree', width: 90, render: (v: ProcessDegree) => <Tag color={DEGREE_COLOR[v]}>{v}</Tag> },
    {
      title: '质检状态',
      dataIndex: 'qcStatus',
      width: 100,
      render: (v: QcStatus, record) => {
        const tag = <Tag color={QC_STATUS_COLOR[v]}>{QC_STATUS_LABEL[v]}</Tag>;
        if (v === 'returned') {
          const lastReturn = lastReturnOf(record);
          if (lastReturn?.reason) {
            return <Tooltip title={`退回原因：${lastReturn.reason}（${formatDateTime(lastReturn.at)}）`}>{tag}</Tooltip>;
          }
        }
        return tag;
      },
    },
    { title: '操作人', dataIndex: 'operator', width: 90 },
    {
      title: '操作',
      width: 250,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          {record.qcStatus === 'returned' ? (
            <Button size="small" type="link" onClick={() => openEdit(record)}>
              编辑
            </Button>
          ) : null}
          {record.qcStatus === 'pending' ? (
            <Popconfirm
              title={`确认放行 ${record.batchNo}？`}
              description="放行后该批定稿，得率与程度不再能改"
              okText="放行"
              cancelText="取消"
              onConfirm={() =>
                releaseBatch(record.id, QC_NAME).then((ok) => {
                  if (ok) {
                    message.success(`${record.batchNo} 已放行定稿`);
                  } else {
                    message.error('该批当前状态不可放行');
                  }
                })
              }
            >
              <Button size="small" type="link">
                放行
              </Button>
            </Popconfirm>
          ) : null}
          {record.qcStatus !== 'returned' ? (
            <Button size="small" type="link" danger onClick={() => openReturn(record)}>
              退回
            </Button>
          ) : null}
          {(record.qcLogs ?? []).length > 0 ? (
            <Button size="small" type="link" onClick={() => setLogsTarget(record)}>
              质检记录
            </Button>
          ) : null}
          <Popconfirm title={`确认删除 ${record.batchNo}？`} onConfirm={() => removeBatch(record.id).then(() => message.success('已删除'))}>
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        炮制工序记录台
      </Title>
      <Paragraph type="secondary">
        选择方法即带出辅料比例、火候与判断标准；录入实际锅温、时长与炮制后重量，系统按标准自动给出程度判定。班组提交后进入待质检；质检员放行即定稿，退回须填写原因并留痕，退回后班组可修改并重新提交。
      </Paragraph>

      <Space style={{ marginBottom: 12 }} wrap>
        <Button type="primary" onClick={openCreate}>
          新建工序记录
        </Button>
        <Button onClick={() => setShowRules((v) => !v)}>{showRules ? '收起程度判定规则' : '查看程度判定规则'}</Button>
      </Space>

      {showRules ? (
        <Card size="small" style={{ marginBottom: 12 }} title="炮制程度判定规则">
          <Table
            rowKey="degree"
            size="small"
            pagination={false}
            dataSource={DEGREE_RULES}
            columns={[
              { title: '程度', dataIndex: 'degree', width: 90, render: (v: ProcessDegree) => <Tag color={DEGREE_COLOR[v]}>{v}</Tag> },
              { title: '判定条件', dataIndex: 'condition' },
              { title: '处置', dataIndex: 'action', width: 280 },
            ]}
          />
        </Card>
      ) : null}

      <FilterBar
        fields={[
          { key: 'origin', label: '基原', options: HERB_ORIGINS, width: 110 },
          { key: 'part', label: '药用部位', options: HERB_PARTS, width: 110 },
          { key: 'degree', label: '程度', options: PROCESS_DEGREES, width: 110 },
          { key: 'qc', label: '质检状态', options: QC_STATUS_OPTIONS, width: 110 },
        ]}
        resultCount={visibleBatches.length}
        totalCount={batches.length}
        keywordPlaceholder="搜索药材名 / 批号"
      />

      {visibleBatches.length === 0 ? (
        <EmptyPanel description="没有符合条件的工序记录" actionText="新建一条工序记录" onAction={openCreate} />
      ) : (
        <Table rowKey="id" size="small" columns={columns} dataSource={visibleBatches} pagination={{ pageSize: 10 }} scroll={{ x: 1400 }} />
      )}

      <Modal
        open={open}
        title={editing ? `工序记录 · ${editing.batchNo}` : '新建炮制工序记录'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText={editing ? '保存并重新提交质检' : '提交并进入待质检'}
        cancelText="取消"
        width={760}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if ('methodId' in changed) {
              const method = methods.find((m) => m.id === changed.methodId);
              if (method) {
                const suggestion = suggestedValues(method);
                const feed = Number(form.getFieldValue('feedKg')) || 0;
                form.setFieldsValue({
                  fireLevel: method.fireLevel,
                  temp: suggestion.temp,
                  duration: suggestion.duration,
                  auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
                } as unknown as BatchFormValues);
              }
            }
            if ('feedKg' in changed) {
              const method = methods.find((m) => m.id === form.getFieldValue('methodId'));
              if (method) {
                const feed = Number(changed.feedKg) || 0;
                form.setFieldsValue({
                  auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
                  outputKg: Number((feed * (method.name === '蜜炙' ? 1.08 : 0.94)).toFixed(1)),
                } as unknown as BatchFormValues);
              }
            }
            if (verdict && ('temp' in changed || 'duration' in changed || 'outputKg' in changed)) {
              form.setFieldsValue({ degree: verdict.degree } as unknown as BatchFormValues);
            }
          }}
        >
          {editing ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该批已被质检退回，修改保存后将重新进入待质检"
              description={
                editingReturn
                  ? `退回原因：${editingReturn.reason ?? '-'}（${editingReturn.qcBy} · ${formatDateTime(editingReturn.at)}）`
                  : undefined
              }
            />
          ) : null}

          <Form.Item name="batchNo" label="生产批号" rules={[{ required: true, message: '请输入生产批号' }]}>
            <Input maxLength={24} />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="herbId" label="药材" rules={[{ required: true, message: '请选择药材' }]} style={{ flex: 1 }}>
              <Select
                showSearch
                optionFilterProp="label"
                options={herbs.map((h) => ({ label: `${h.name} · ${h.batchNo}（${h.feedKg}kg）`, value: h.id }))}
              />
            </Form.Item>
            <Form.Item name="methodId" label="炮制方法" rules={[{ required: true, message: '请选择炮制方法' }]} style={{ flex: 1 }}>
              <Select
                options={methods.map((m) => ({ label: `${m.name} · ${m.auxiliary} ${m.auxRatio}kg/100kg`, value: m.id }))}
              />
            </Form.Item>
          </Space>

          {watchedMethod ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={
                <Space wrap size={8}>
                  <span>辅料比例 {watchedMethod.auxRatio}kg/100kg</span>
                  <FireLevelTag level={watchedMethod.fireLevel} tempRange={watchedMethod.tempRange} duration={watchedMethod.duration} />
                  <Tag>{watchedMethod.criterionDimension}</Tag>
                </Space>
              }
              description={`判断标准：${watchedMethod.criterion}；适用药材：${watchedMethod.applicable}`}
            />
          ) : null}

          <RatioCalculator
            auxRatio={watchedMethod?.auxRatio ?? 0}
            auxiliary={watchedMethod?.auxiliary ?? '无'}
            feedKg={Number(watched?.feedKg) || 0}
            auxUsedKg={Number(watched?.auxUsedKg) || 0}
            outputKg={Number(watched?.outputKg) || 0}
            onChange={(patch) => {
              if (patch.feedKg !== undefined) {
                form.setFieldsValue({ feedKg: patch.feedKg } as unknown as BatchFormValues);
              }
              if (patch.auxUsedKg !== undefined) {
                form.setFieldsValue({ auxUsedKg: patch.auxUsedKg } as unknown as BatchFormValues);
              }
            }}
          />

          <Space size={12} style={{ display: 'flex', marginTop: 12 }} align="start">
            <Form.Item name="fireLevel" label="火力" rules={[{ required: true, message: '请选择火力' }]}>
              <Select style={{ width: 120 }} options={FIRE_LEVELS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="temp" label="实际锅温(℃)" rules={[{ required: true, message: '请输入实际锅温' }]}>
              <InputNumber min={0} max={800} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="duration" label="炮制时长(min)" rules={[{ required: true, message: '请输入炮制时长' }]}>
              <InputNumber min={0} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="outputKg" label="炮制后重量(kg)" rules={[{ required: true, message: '请输入炮制后重量' }]}>
              <InputNumber min={0} step={0.5} style={{ width: 150 }} />
            </Form.Item>
          </Space>

          <Form.Item name="feedKg" label="投料量(kg)" rules={[{ required: true, message: '请输入投料量' }]} style={{ maxWidth: 200 }}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} />
          </Form.Item>

          <Alert
            type={verdict?.degree === '适中' ? 'success' : verdict?.degree === '太过' ? 'error' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message={`系统判定：${verdict?.degree ?? '待录入火候与得率'}（得率 ${watchedYieldRate}%，预期 ${verdict?.expectedYield ?? '-'}%）`}
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(verdict?.reasons ?? ['选择方法并录入锅温、时长、炮制后重量后自动判定']).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            }
          />

          <Form.Item name="degree" label="程度判定（可按判断标准复核后修改）" rules={[{ required: true, message: '请选择程度' }]}>
            <Select options={PROCESS_DEGREES.map((v) => ({ label: v, value: v }))} />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="startedAt" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
              <DatePicker showTime style={{ width: 190 }} />
            </Form.Item>
            <Form.Item name="endedAt" label="结束时间" rules={[{ required: true, message: '请选择结束时间' }]}>
              <DatePicker showTime style={{ width: 190 }} />
            </Form.Item>
            <Form.Item name="operator" label="操作人" rules={[{ required: true, message: '请输入操作人' }]}>
              <Input style={{ width: 140 }} maxLength={16} />
            </Form.Item>
          </Space>

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={80} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(returnTarget)}
        title={`退回批次 · ${returnTarget?.batchNo ?? ''}`}
        onCancel={() => setReturnTarget(null)}
        onOk={submitReturn}
        okText="确认退回"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        width={480}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="退回后班组可修改得率与程度，并需重新提交质检；退回原因与时间将留痕，可随时在「质检记录」中查看。"
        />
        <Form form={returnForm} layout="vertical">
          <Form.Item
            name="reason"
            label="退回原因"
            rules={[
              { required: true, message: '请填写退回原因' },
              { whitespace: true, message: '退回原因不能为空' },
            ]}
          >
            <Input.TextArea rows={3} maxLength={100} placeholder="必填：说明退回原因，便于班组复核修改" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(logsTarget)}
        title={`质检记录 · ${logsTarget?.batchNo ?? ''}`}
        onCancel={() => setLogsTarget(null)}
        footer={null}
        width={520}
      >
        <Timeline
          items={[...(logsTarget?.qcLogs ?? [])].reverse().map((log) => ({
            color: log.action === '放行' ? 'green' : 'orange',
            children: (
              <div>
                <Space size={8}>
                  <Text strong>{log.action}</Text>
                  <Text type="secondary">
                    {log.qcBy} · {formatDateTime(log.at)}
                  </Text>
                </Space>
                {log.reason ? <div style={{ fontSize: 12, marginTop: 4 }}>退回原因：{log.reason}</div> : null}
              </div>
            ),
          }))}
        />
      </Modal>
    </div>
  );
}
