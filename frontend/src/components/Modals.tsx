import { useEffect, useRef, useState } from 'react';
import { Button, Input, InputArea, Select } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import {
  SETTLE_OPTIONS,
  boardApi,
  looseUrl,
  topicApi,
  uploadApi,
  PLATFORMS,
  PLATFORM_COLORS,
  PLATFORM_LABELS,
} from '../api';
import type {
  MediaLink,
  Topic,
  TopicDetail as TopicDetailT,
  TrafficDayInput,
} from '../types';
import { Loading, fmtMoney, fmtTime } from './common';
import { Modal } from './Modal';
import { TopicDetail } from './TopicDetail';

// echarts 仅在流量填报弹窗中使用，动态加载以减小首屏体积
type EChartsInstance = {
  setOption: (option: unknown, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
};

export function Modals() {
  const { modal, closeModal } = useApp();
  switch (modal.type) {
    case 'topic':
      return <TopicDetail id={modal.id} onClose={closeModal} />;
    case 'create':
      return <CreateTopic onClose={closeModal} />;
    case 'edit':
      return <EditTopic id={modal.id} onClose={closeModal} />;
    case 'traffic':
      return <TrafficModal id={modal.id} onClose={closeModal} />;
    case 'review':
      return <ReviewModal id={modal.id} onClose={closeModal} />;
    case 'settle':
      return <SettleModal id={modal.id} onClose={closeModal} />;
    case 'boardEdit':
      return <BoardEdit onClose={closeModal} />;
    case 'tutorial':
      return <Tutorial onClose={closeModal} />;
    default:
      return null;
  }
}

/* ============ 发布 / 修改 选题 ============ */
interface TopicFormState {
  title: string;
  intro: string;
  series: string;
  refs: string;
  copy: string;
  media: MediaLink[];
  workType: string;
  deadline: string;
}

function readForm(s: TopicFormState) {
  const referenceLinks = s.refs.split('\n').map((x) => x.trim()).filter(Boolean);
  const mediaLinks = s.media.filter((m) => m.url.trim());
  const deadline = s.deadline ? s.deadline.replace('T', ' ') : '';
  const series = s.series;
  return {
    title: s.title,
    intro: s.intro,
    referenceLinks,
    copyText: s.copy,
    mediaLinks,
    workType: s.workType,
    deadline,
    series,
  };
}

function TopicFormBase({
  initial,
  onClose,
  onSubmit,
  submitLabel,
}: {
  initial?: TopicDetailT | Topic;
  onClose: () => void;
  onSubmit: (body: any) => Promise<void>;
  submitLabel: string;
}) {
  const { toast } = useApp();
  const [s, setS] = useState<TopicFormState>({
    title: (initial as any)?.title || '',
    intro: (initial as any)?.intro || '',
    series: ((initial as any)?.series || []).join(' '),
    refs: ((initial as any)?.referenceLinks || []).join('\n'),
    copy: (initial as any)?.copyText || '',
    media: (initial as any)?.mediaLinks || [],
    workType: (initial as any)?.workType || '',
    deadline: ((initial as any)?.deadline || '').replace(' ', 'T'),
  });
  const [linkForced, setLinkForced] = useState(false);
  const [warn, setWarn] = useState('');

  const submit = async () => {
    const body = readForm(s);
    const invalid = [
      ...body.referenceLinks.filter((r) => !looseUrl(r)),
      ...body.mediaLinks.filter((m) => !looseUrl(m.url)).map((m) => m.url),
    ];
    if (invalid.length && !linkForced) {
      setLinkForced(true);
      setWarn(
        `⚠️ 以下链接格式可能有误，已照常提交（链接不阻止${submitLabel}）：\n` +
          invalid.map((x) => '· ' + x).join('\n')
      );
      toast('部分链接格式可能有误，已标红；确认无误可再次点击' + submitLabel);
      return;
    }
    try {
      await onSubmit(body);
    } catch (e) {
      toast(e instanceof Error ? e.message : '操作失败');
    }
  };

  return (
    <Modal title={submitLabel === '发布' ? '发布选题' : '修改选题'} onClose={onClose}>
      {warn && <div className="linkwarn">{warn}</div>}
      <div className="field">
        <label>选题标题 *</label>
        <Input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} placeholder="选题标题" />
      </div>
      <div className="field">
        <label>选题简介</label>
        <InputArea value={s.intro} onChange={(e) => setS({ ...s, intro: e.target.value })} />
      </div>
      <div className="field">
        <label>话题系列（用 # 分隔，如 #综艺 #泛生活）</label>
        <Input value={s.series} onChange={(e) => setS({ ...s, series: e.target.value })} placeholder="#综艺 #泛生活" />
      </div>
      <div className="field">
        <label>参考链接（每行一个，自动校验）</label>
        <InputArea value={s.refs} onChange={(e) => setS({ ...s, refs: e.target.value })} placeholder="https://..." />
      </div>
      <div className="field">
        <label>文案内容</label>
        <InputArea value={s.copy} onChange={(e) => setS({ ...s, copy: e.target.value })} placeholder="可直接粘贴文案" />
      </div>
      <div className="field">
        <label>图片 / 视频外链</label>
        <div id="ct-media-list">
          {s.media.map((m, i) => (
            <div className="mat-item" key={i}>
              <span>
                {m.type === 'image' ? '🖼️' : '🎬'} {m.url}
              </span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setS({ ...s, media: s.media.filter((_, j) => j !== i) })}
              >
                删
              </Button>
            </div>
          ))}
        </div>
        <div className="repeat-row">
          <Select
            aria-label="类型"
            value={'image'}
            onValueChange={() => {}}
            items={{ image: '图片', video: '视频' }}
          />
          <Input
            className="grow"
            placeholder="外链 URL"
            onKeyDown={(e) => {
              const v = (e.target as HTMLInputElement).value.trim();
              if ((e as React.KeyboardEvent).key === 'Enter' && v) {
                setS({ ...s, media: [...s.media, { type: 'image', url: v }] });
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              const inp = document.querySelector('.repeat-row input') as HTMLInputElement | null;
              const v = inp?.value.trim();
              if (v) {
                setS({ ...s, media: [...s.media, { type: 'image', url: v }] });
                if (inp) inp.value = '';
              }
            }}
          >
            添加
          </Button>
        </div>
      </div>
      <div className="field">
        <label>接单类型（接单者可在认领时确认/修改）</label>
        <Select
          aria-label="接单类型"
          value={s.workType}
          onValueChange={(v) => setS({ ...s, workType: v as string })}
          items={{ '': '由接单者选择', full: '全流程（文案+视频）¥40', copywriting: '仅文案 ¥15' }}
        />
      </div>
      <div className="field">
        <label>交付截止时间（可选）</label>
        <Input type="datetime-local" value={s.deadline} onChange={(e) => setS({ ...s, deadline: e.target.value })} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </Modal>
  );
}

function CreateTopic({ onClose }: { onClose: () => void }) {
  const { toast, navigate, refreshView, refreshPending } = useApp();
  return (
    <TopicFormBase
      submitLabel="发布"
      onClose={onClose}
      onSubmit={async (body) => {
        await topicApi.create(body);
        toast('选题已发布');
        refreshView();
        refreshPending();
        onClose();
        navigate('market');
      }}
    />
  );
}

function EditTopic({ id, onClose }: { id: number; onClose: () => void }) {
  const { toast, refreshView } = useApp();
  const [init, setInit] = useState<TopicDetailT | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    topicApi.get(id).then(setInit).finally(() => setLoading(false));
  }, [id]);
  if (loading || !init) return <Modal title="修改选题" onClose={onClose}><Loading /></Modal>;
  return (
    <TopicFormBase
      initial={init}
      submitLabel="保存修改"
      onClose={onClose}
      onSubmit={async (body) => {
        await topicApi.update(id, body);
        toast('选题已修改');
        refreshView();
        onClose();
      }}
    />
  );
}

/* ============ 审核 ============ */
function ReviewModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { toast, refreshView, refreshPending } = useApp();
  const [t, setT] = useState<TopicDetailT | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    topicApi.get(id).then(setT).finally(() => setLoading(false));
  }, [id]);

  if (loading || !t) return <Modal title="审核" onClose={onClose}><Loading /></Modal>;
  const stageName = t.reviewStage === 'video' ? '视频' : '文案';
  const rejects = (t.rejectedNotes || []).map((n, i) => (
    <div className="reject-note" key={i}>
      ↩️ 第 {i + 1} 次驳回（{fmtTime(n.at)}）：{n.note}
    </div>
  ));
  const videoBlock = () => {
    if (t.videoType === 'offline' && t.videoLink)
      return <video src={t.videoLink} controls style={{ width: '100%', borderRadius: 12, maxHeight: 360, background: '#000' }} />;
    if (t.videoType === 'import' && t.videoLink)
      return (
        <a href={t.videoLink} target="_blank" rel="noopener" className="video-link">
          ▶ 打开视频链接（{t.videoLink}）
        </a>
      );
    return <span className="pill">暂无提交视频</span>;
  };

  const approve = async () => {
    if (!window.confirm('确认通过审核？')) return;
    try {
      await topicApi.review(id, 'approve');
      toast('已通过审核');
      refreshView();
      refreshPending();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : '审核失败');
    }
  };
  const reject = async () => {
    const note = window.prompt('请填写驳回修改备注：');
    if (note == null) return;
    try {
      await topicApi.review(id, 'reject', note);
      toast('已驳回');
      refreshView();
      refreshPending();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : '驳回失败');
    }
  };

  return (
    <Modal title={`审核 · ${t.title}`} onClose={onClose}>
      <div className="meta" style={{ marginBottom: 8 }}>
        <span className="tag review">{stageName}待审</span>
      </div>
      <div className="detail-section">
        <h4>📝 文案内容</h4>
        <div className="copy-box">{t.copyText || '（未填写文案）'}</div>
      </div>
      <div className="detail-section">
        <h4>🎬 提交视频</h4>
        {videoBlock()}
      </div>
      {rejects}
      <div className="modal-actions">
        <Button variant="destructive" onClick={reject}>
          驳回返修
        </Button>
        <Button variant="primary" onClick={approve}>
          通过审核
        </Button>
      </div>
    </Modal>
  );
}

/* ============ 结算 ============ */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

function SettleModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { toast, refreshView, refreshPending, navigate, me } = useApp();
  const [t, setT] = useState<TopicDetailT | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [detail, setDetail] = useState(SETTLE_OPTIONS[0]);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    topicApi
      .get(id)
      .then((d) => {
        setT(d);
        setAmount(String(d.displayAmount || ''));
        setEvidence(d.settlementEvidence || []);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading || !t) return <Modal title="录入结算" onClose={onClose}><Loading /></Modal>;

  const onFile = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const data = await readFileAsDataURL(f);
        const r = await uploadApi.image(data, f.name);
        setEvidence((e) => [...e, r.url]);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (action: 'save' | 'pay') => {
    try {
      await topicApi.settle(id, { amount: Number(amount), detail, action, evidence });
      toast(action === 'pay' ? '已确认结款' : '已保存结算信息');
      refreshView();
      refreshPending();
      onClose();
      navigate(me?.role === 'admin' ? 'review' : 'mine');
    } catch (e) {
      toast(e instanceof Error ? e.message : '结算失败');
    }
  };

  return (
    <Modal title="录入结算" onClose={onClose}>
      <div className="field">
        <label>结算金额（元）</label>
        <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="field">
        <label>结算明细（单选）</label>
        {SETTLE_OPTIONS.map((o) => (
          <label key={o} style={{ display: 'block', margin: '6px 0' }}>
            <input type="radio" name="st" checked={detail === o} onChange={() => setDetail(o)} /> {o}
          </label>
        ))}
      </div>
      <div className="field">
        <label>结算凭证图片（证据保留）</label>
        <input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => onFile(e.target.files)} />
        <div className="ev-grid">
          {evidence.map((u, i) => (
            <div className="ev-item" key={i}>
              <img src={u} alt="" />
              <Button size="sm" variant="destructive" onClick={() => setEvidence((e) => e.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <Button onClick={() => submit('save')}>仅保存</Button>
        <Button variant="primary" onClick={() => submit('pay')}>
          确认结款
        </Button>
      </div>
    </Modal>
  );
}

/* ============ 视频流量填报 ============ */
type Num = string | number | undefined;
type PlatNums = { views?: Num; likes?: Num; favorites?: Num };
type EditableDay = {
  date: string;
  douyin: PlatNums;
  kuaishou: PlatNums;
  xiaohongshu: PlatNums;
};

function TrafficChart({ days, metric }: { days: EditableDay[]; metric: 'views' | 'likes' | 'favorites' }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  const [ready, setReady] = useState(0);
  const hasData = days.length > 0;

  useEffect(() => {
    if (!hasData) return;
    let disposed = false;
    let chart: EChartsInstance | null = null;
    let onResize: (() => void) | null = null;
    (async () => {
      const echarts = await import('echarts');
      if (disposed || !ref.current) return;
      chart = echarts.init(ref.current) as unknown as EChartsInstance;
      chartRef.current = chart;
      onResize = () => chart && chart.resize();
      window.addEventListener('resize', onResize);
      setReady((n) => n + 1);
    })();
    return () => {
      disposed = true;
      if (onResize) window.removeEventListener('resize', onResize);
      if (chart) chart.dispose();
      chartRef.current = null;
    };
  }, [hasData]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const maxV = Math.max(
      1,
      ...days.map((d) => Math.max(...PLATFORMS.map((p) => +(d[p] as any)?.[metric] || 0)))
    );
    const option = {
      grid: { left: 46, right: 14, top: 22, bottom: 34 },
      tooltip: { trigger: 'axis' },
      legend: { data: PLATFORMS.map((p) => PLATFORM_LABELS[p]), bottom: 0 },
      xAxis: {
        type: 'category',
        data: days.map((d) => (d.date || '').slice(5)),
        axisLine: { lineStyle: { color: '#e5e5ea' } },
      },
      yAxis: {
        type: 'value',
        max: maxV,
        splitLine: { lineStyle: { color: '#f0f0f3' } },
      },
      series: PLATFORMS.map((p) => ({
        name: PLATFORM_LABELS[p],
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: PLATFORM_COLORS[p] },
        lineStyle: { color: PLATFORM_COLORS[p], width: 2.5 },
        data: days.map((d) => +(d[p] as any)?.[metric] || 0),
      })),
    };
    chart.setOption(option, true);
  }, [days, metric, ready]);

  if (!days.length) return <div className="chart-empty">暂无数据，添加一天后查看三平台对比</div>;
  return <div ref={ref} className="tf-svg" style={{ width: '100%', height: 260 }} />;
}

function TrafficModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { toast, refreshView, refreshPending } = useApp();
  const [t, setT] = useState<TopicDetailT | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<EditableDay[]>([]);
  const [metric, setMetric] = useState<'views' | 'likes' | 'favorites'>('views');

  useEffect(() => {
    topicApi.get(id).then((d) => {
      setT(d);
      const init: EditableDay[] = (d.trafficDays || []).map((x) => ({
        date: x.date,
        douyin: { ...x.douyin },
        kuaishou: { ...x.kuaishou },
        xiaohongshu: { ...x.xiaohongshu },
      }));
      setDays(init);
      setLoading(false);
    });
  }, [id]);

  if (loading || !t) return <Modal title="填报视频流量" onClose={onClose}><Loading /></Modal>;

  const today = new Date().toISOString().slice(0, 10);
  const setCell = (i: number, p: 'douyin' | 'kuaishou' | 'xiaohongshu', k: 'views' | 'likes' | 'favorites', v: string) => {
    setDays((ds) => ds.map((d, j) => (j === i ? { ...d, [p]: { ...d[p], [k]: v } } : d)));
  };
  const totals = PLATFORMS.reduce((acc, p) => {
    acc[p] = { views: 0, likes: 0, favorites: 0 };
    days.forEach((d) => {
      acc[p].views += +(d[p] as any)?.views || 0;
      acc[p].likes += +(d[p] as any)?.likes || 0;
      acc[p].favorites += +(d[p] as any)?.favorites || 0;
    });
    return acc;
  }, {} as Record<string, any>);

  const save = async () => {
    if (!days.length || !days[0].date) return toast('请至少添加一天并填写日期');
    try {
      await topicApi.traffic(id, days);
      toast('已保存');
      refreshView();
      refreshPending();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败');
    }
  };

  return (
    <Modal title="填报视频流量" onClose={onClose}>
      <p className="hint" style={{ margin: '0 0 12px' }}>
        选题《{t.title}》· 7 天内按三平台填报（截止 {t.trafficDueAt ? fmtTime(t.trafficDueAt) : '—'}）
      </p>
      <div className="metric-toggle">
        {(['views', 'likes', 'favorites'] as const).map((m) => (
          <button key={m} className={'mt-btn' + (metric === m ? ' active' : '')} onClick={() => setMetric(m)}>
            {m === 'views' ? '播放量' : m === 'likes' ? '点赞数' : '收藏数'}
          </button>
        ))}
      </div>
      <div className="tf-chart">
        <TrafficChart days={days} metric={metric} />
      </div>
      <div className="tf-summary">
        {PLATFORMS.map((p) => (
          <div className="pf-card" key={p} style={{ borderColor: PLATFORM_COLORS[p] }}>
            <div className="pf-name" style={{ color: PLATFORM_COLORS[p] }}>{PLATFORM_LABELS[p]}</div>
            <div className="pf-row">▶ {totals[p].views}</div>
            <div className="pf-row">👍 {totals[p].likes}</div>
            <div className="pf-row">⭐ {totals[p].favorites}</div>
          </div>
        ))}
      </div>
      <h4 style={{ margin: '14px 0 8px' }}>每日数据（可添加多天形成时间线）</h4>
      <div className="tf-days">
        {days.map((d, i) => (
          <div className="tf-day" key={i}>
            <div className="tf-day-head">
              <input type="date" className="tf-date" value={d.date} onChange={(e) => setDays((ds) => ds.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
              <Button size="sm" variant="destructive" onClick={() => setDays((ds) => ds.filter((_, j) => j !== i))}>删除</Button>
            </div>
            <div className="tf-plats">
              {PLATFORMS.map((p) => (
                <div className="tf-plat" key={p} style={{ borderColor: PLATFORM_COLORS[p] }}>
                  <span className="tf-plat-name" style={{ color: PLATFORM_COLORS[p] }}>{PLATFORM_LABELS[p]}</span>
                  <input className="tf-num" placeholder="播放" value={(d[p] as any)?.views ?? ''} onChange={(e) => setCell(i, p, 'views', e.target.value)} />
                  <input className="tf-num" placeholder="点赞" value={(d[p] as any)?.likes ?? ''} onChange={(e) => setCell(i, p, 'likes', e.target.value)} />
                  <input className="tf-num" placeholder="收藏" value={(d[p] as any)?.favorites ?? ''} onChange={(e) => setCell(i, p, 'favorites', e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {!days.length && <div className="muted" style={{ padding: '8px 0' }}>还没有数据，点下方「＋ 添加一天」开始填报</div>}
      </div>
      <Button size="sm" onClick={() => setDays((ds) => [...ds, { date: today, douyin: { views: '', likes: '', favorites: '' }, kuaishou: { views: '', likes: '', favorites: '' }, xiaohongshu: { views: '', likes: '', favorites: '' } }])} style={{ margin: '8px 0 4px' }}>
        ＋ 添加一天
      </Button>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={save}>保存填报</Button>
      </div>
    </Modal>
  );
}

/* ============ 公告栏编辑 ============ */
function BoardEdit({ onClose }: { onClose: () => void }) {
  const { toast, refreshView } = useApp();
  const [notice, setNotice] = useState('');
  const [videos, setVideos] = useState<{ title: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    boardApi.get().then((b) => {
      setNotice(b.notice || '');
      setVideos(b.referenceVideos || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <Modal title="编辑公告栏" onClose={onClose}><Loading /></Modal>;

  return (
    <Modal title="编辑公告栏" onClose={onClose}>
      <div className="field">
        <label>公告文字（选填）</label>
        <InputArea value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="例如：本周重点选题方向…" />
      </div>
      <div className="field">
        <label>参考视频栏（仅管理员可改）</label>
        <div id="ba-vlist">
          {videos.map((v, i) => (
            <div className="repeat-row" key={i}>
              <Input className="grow" placeholder="标题" value={v.title} onChange={(e) => setVideos((vs) => vs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <Input className="grow" placeholder="视频链接 https://" value={v.url} onChange={(e) => setVideos((vs) => vs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <Button size="sm" variant="destructive" onClick={() => setVideos((vs) => vs.filter((_, j) => j !== i))}>删</Button>
            </div>
          ))}
          {!videos.length && <span className="pill">暂无</span>}
        </div>
        <Button size="sm" onClick={() => setVideos((vs) => [...vs, { title: '', url: '' }])} style={{ marginTop: 8 }}>
          ＋ 添加视频
        </Button>
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await boardApi.update(notice, videos);
              toast('公告栏已更新');
              refreshView();
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : '保存失败');
            }
          }}
        >
          保存
        </Button>
      </div>
    </Modal>
  );
}

/* ============ 新手教程 ============ */
const TUTORIAL = [
  { t: '欢迎使用协作工作台', d: '这是选题进度跟踪与作品验收结算的一体化后台。左栏是导航，按角色展示不同功能。随时点右上角 📘 可重看本教程。' },
  { t: '1 · 认领选题', d: '在「选题接单」浏览待认领选题，点击卡片可认领。认领时选择「全流程（文案+视频）」或「仅文案」，单价不同：全流程 ¥40 / 仅文案 ¥15。' },
  { t: '2 · 制作与提交', d: '认领后进入「制作交付」。按阶段推进：文案制作 → 提交文案审核 →（全流程）视频制作 → 提交视频审核。管理员审核通过即完结。' },
  { t: '3 · 视频流量填报', d: '全流程选题的视频审核通过发布后，请在「视频流量」页 7 天内填报播放量 / 点赞 / 收藏，逾期会有提醒。' },
  { t: '4 · 结算与证据', d: '管理员在「审核」页录入金额并确认结款，可上传结算凭证图片作为证据留存，也支持周结算与账单导出。' },
  { t: '5 · 公告栏参考视频', d: '「公告看板」顶部有参考视频栏（管理员维护）与公告，供大家参考学习。' },
];

function Tutorial({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [i, setI] = useState(0);
  return (
    <Modal title={TUTORIAL[i].t} onClose={onClose} wide>
      <div className="tut">
        <span className="pill">{i + 1} / {TUTORIAL.length}</span>
        <p className="tut-body" style={{ marginTop: 14 }}>{TUTORIAL[i].d}</p>
        <div className="tut-dots">
          {TUTORIAL.map((_, k) => (
            <span className={'dot' + (k === i ? ' on' : '')} key={k} />
          ))}
        </div>
        <div className="tut-actions">
          <Button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>上一步</Button>
          {i < TUTORIAL.length - 1 ? (
            <Button variant="primary" onClick={() => setI((x) => x + 1)}>下一步</Button>
          ) : (
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await (await import('../api')).authApi.tutorialDone();
                } catch {
                  /* ignore */
                }
                toast('教程已结束');
                onClose();
              }}
            >
              开始使用
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
