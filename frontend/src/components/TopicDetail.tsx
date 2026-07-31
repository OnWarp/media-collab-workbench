import { useEffect, useState } from 'react';
import { Badge, Button, InputArea } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import { topicApi } from '../api';
import type { TopicDetail as TopicDetailT, Topic, WorkType } from '../types';
import { Modal } from './Modal';
import {
  FavStar,
  Loading,
  PriceTag,
  SettleTag,
  StageBar,
  StatusTag,
  fmtTime,
  fmtMoney,
} from './common';

function videoBlock(t: TopicDetailT) {
  if (t.videoType === 'offline' && t.videoLink) {
    return (
      <video src={t.videoLink} controls style={{ width: '100%', borderRadius: 12, maxHeight: 360, background: '#000' }} />
    );
  }
  if (t.videoType === 'import' && t.videoLink) {
    return (
      <a href={t.videoLink} target="_blank" rel="noopener" className="video-link">
        ▶ 打开视频链接（{t.videoLink}）
      </a>
    );
  }
  const mv = (t.mediaLinks || []).filter((m) => m.type === 'video');
  if (mv.length)
    return mv.map((m) => (
      <a key={m.url} href={m.url} target="_blank" rel="noopener" className="video-link">
        🎬 视频外链：{m.url}
      </a>
    ));
  return <span className="pill">暂无提交视频</span>;
}

export function TopicDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { me, toast, refreshView, refreshPending, openModal } = useApp();
  const [t, setT] = useState<TopicDetailT | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [claimOpen, setClaimOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState<null | 'discard' | 'remove'>(null);

  const reload = async () => {
    try {
      setT(await topicApi.get(id));
    } catch (e) {
      toast(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      await reload();
      refreshView();
      refreshPending();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : '操作失败');
      return false;
    }
  };

  if (loading || !t) return <Modal title="选题详情" onClose={onClose}><Loading /></Modal>;

  const isClaimer = t.claimerId === me?.id;
  const isAdmin = me?.role === 'admin';
  const isAuthor = t.createdBy === me?.id;
  const faved = (t.favoritedBy || []).includes(me?.id ?? -1);

  // ---- 操作按钮 ----
  const actions: React.ReactNode[] = [];
  if (t.recycled) {
    actions.push(
      <span key="r" className="tag recycled">
        已进入回收站（{t.recycledReason === 'delete' ? '删除' : '废弃'}）· 还剩 {t.recycleDaysLeft} 天自动清除
      </span>
    );
    if (isAdmin || isAuthor)
      actions.push(
        <Button key="restore" variant="primary" onClick={() => act(() => topicApi.restore(id), '已恢复')}>
          恢复选题
        </Button>
      );
    if (isAdmin)
      actions.push(
        <Button key="purge" variant="destructive" onClick={async () => {
          const success = await act(() => topicApi.purge(id), '已永久删除');
          if (success) onClose();
        }}>
          永久删除
        </Button>
      );
  } else {
    if (t.status === 'pending' && !isAuthor && !isAdmin)
      actions.push(<Button key="claim" variant="primary" onClick={() => setClaimOpen(true)}>认领选题</Button>);
    if (t.status === 'pending' && isAdmin)
      actions.push(<Button key="claim" variant="primary" onClick={() => setClaimOpen(true)}>代成员认领</Button>);
    if (isClaimer && t.status === 'in_progress') {
      if (t.stage === 'confirm')
        actions.push(<Button key="stage" onClick={() => act(() => topicApi.stage(id), '已开始制作（进入文案）')}>开始制作（进入文案）</Button>);
      if (t.stage === 'copywriting') {
        actions.push(<Button key="sc" variant="primary" onClick={() => setCopyOpen(true)}>提交文案审核</Button>);
        actions.push(<Button key="mat" onClick={() => material()}>留存素材</Button>);
        actions.push(<Button key="dl" onClick={() => setDeadline()}>设置截止时间</Button>);
        actions.push(<Button key="ab" variant="destructive" onClick={() => abandon()}>申请弃单</Button>);
      }
      if (t.stage === 'video') {
        actions.push(<Button key="sv" variant="primary" onClick={() => setVideoOpen(true)}>提交视频审核</Button>);
        actions.push(<Button key="mat" onClick={() => material()}>留存素材</Button>);
        actions.push(<Button key="dl" onClick={() => setDeadline()}>设置截止时间</Button>);
        actions.push(<Button key="ab" variant="destructive" onClick={() => abandon()}>申请弃单</Button>);
      }
    }
    if (isClaimer && t.status === 'review')
      actions.push(<span key="w" className="pill">{t.reviewStage === 'video' ? '视频' : '文案'}已提交，等待管理员审核</span>);
    if (isAdmin && t.status === 'review')
      actions.push(<span key="w" className="pill">{t.reviewStage === 'video' ? '视频' : '文案'}待管理员审核（请到「审核」页处理）</span>);
    if (isAdmin && t.status === 'finished' && t.settlementStatus === 'unsettled')
      actions.push(<Button key="settle" onClick={() => openModal({ type: 'settle', id })}>录入金额并结款</Button>);
    if (t.abandonRequested && (isAdmin || isAuthor))
      actions.push(<Button key="abok" onClick={() => act(() => topicApi.abandonApprove(id), '弃单已通过')}>审批弃单（通过）</Button>);
    const canDiscard = isAdmin || isAuthor || isClaimer;
    const canDelete = isAdmin || isAuthor;
    if (isAdmin || (isAuthor && t.status !== 'finished'))
      actions.push(<Button key="edit" onClick={() => openModal({ type: 'edit', id })}>✎ 修改选题</Button>);
    if (canDiscard)
      actions.push(<Button key="discard" onClick={() => setDiscardOpen('discard')}>废弃选题</Button>);
    if (canDelete)
      actions.push(<Button key="remove" variant="destructive" onClick={() => setDiscardOpen('remove')}>删除选题</Button>);
    actions.push(
      <Button key="fav" onClick={() => act(async () => { const r = await topicApi.favorite(id); return r.favorited; }, faved ? '已取消收藏' : '已收藏')}>
        {faved ? '★ 取消收藏' : '☆ 收藏'}
      </Button>
    );
  }

  const material = async () => {
    const url = window.prompt('素材外链 URL：');
    if (!url) return;
    const note = window.prompt('素材备注（可选）：') || '';
    await act(() => topicApi.material(id, url, note), '素材已留存');
  };
  const setDeadline = async () => {
    const v = window.prompt('设置交付截止时间（格式：2026-08-01 18:00，留空清除）：', t.deadline || '');
    if (v === null) return;
    await act(() => topicApi.deadline(id, v.trim()), '已更新');
  };
  const abandon = async () => {
    if (!window.confirm('确认申请放弃该选题？需发布者/管理员审批')) return;
    await act(() => topicApi.abandon(id), '已提交弃单申请');
  };

  const sendComment = async () => {
    if (!comment.trim()) return;
    try {
      await topicApi.comment(id, comment);
      setComment('');
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : '评论失败');
    }
  };

  const rejects = (t.rejectedNotes || []).map((n, i) => (
    <div className="reject-note" key={i}>
      ↩️ 第 {i + 1} 次驳回（{fmtTime(n.at)}）：{n.note}
    </div>
  ));

  return (
    <Modal title={t.title} onClose={onClose} wide>
      <div className="meta" style={{ marginBottom: 10 }}>
        <StatusTag t={t} />
        <PriceTag t={t} />
        <SettleTag t={t} />
        {t.overdue && <span className="tag overdue">⏰ 已超时</span>}
        {t.recycled && <span className="tag recycled">🗑️ 回收站</span>}
        {t.deadline && <span className="pill">截止：{t.deadline}</span>}
        {t.createdAtLabel && <span className="pill">🕒 {t.createdAtLabel}</span>}
      </div>
      <StageBar t={t} />
      {rejects}
      <p style={{ color: 'var(--ink-2)' }}>{t.intro || '（无简介）'}</p>
      {t.series && t.series.length > 0 && (
        <div className="detail-section">
          <h4>话题系列</h4>
          <div className="series-tags">
            {t.series.map((s) => (
              <span className="series-tag" key={s}>#{s}</span>
            ))}
          </div>
        </div>
      )}
      <div className="detail-section">
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <div><b>发布者：</b>{t.authorName}</div>
          <div><b>认领人：</b>{t.claimerName || '—'}</div>
          <div><b>状态：</b>{t.statusLabel}</div>
          <div><b>类型：</b>{t.workTypeLabel}</div>
          <div><b>结款：</b>{t.settleLabel}{t.displayAmount ? ' ' + fmtMoney(t.displayAmount) : ''}</div>
          {t.settlementDetail && <div><b>结算明细：</b>{t.settlementDetail}</div>}
        </div>
      </div>
      <div className="detail-section">
        <h4>参考链接</h4>
        <div className="link-list">
          {(t.referenceLinks || []).length ? (
            t.referenceLinks.map((r, i) => (
              <a key={i} href={r} target="_blank" rel="noopener">{r}</a>
            ))
          ) : (
            <span className="pill">无</span>
          )}
        </div>
      </div>
      <div className="detail-section">
        <h4>图片 / 视频外链</h4>
        <div className="link-list">
          {(t.mediaLinks || []).length ? (
            t.mediaLinks.map((m, i) => (
              <a key={i} href={m.url} target="_blank" rel="noopener">
                {m.type === 'image' ? '🖼️ 图片' : '🎬 视频'} {m.url}
              </a>
            ))
          ) : (
            <span className="pill">无</span>
          )}
        </div>
      </div>
      {t.copyText && (
        <div className="detail-section">
          <h4>文案内容</h4>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: '#f7f8fa', padding: 12, borderRadius: 8 }}>
            {t.copyText}
          </div>
        </div>
      )}
      {(t.videoType || (t.mediaLinks || []).some((m) => m.type === 'video')) && (
        <div className="detail-section">
          <h4>提交视频</h4>
          {videoBlock(t)}
        </div>
      )}
      {t.settlementEvidence && t.settlementEvidence.length > 0 && (
        <div className="detail-section">
          <h4>结算凭证（证据 · {t.settlementEvidence.length}）</h4>
          <div className="ev-grid">
            {t.settlementEvidence.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noopener">
                <img src={u} className="ev-img" />
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="detail-section">
        <h4>素材版本（{t.materials.length}）</h4>
        {t.materials.length ? (
          t.materials.map((m, i) => (
            <div className="mat-item" key={m.id}>
              <span>
                v{m.version} · {m.url} {m.note ? '（' + m.note + '）' : ''}
              </span>
              <span className="mwhen">{m.userName} {fmtTime(m.createdAt)}</span>
            </div>
          ))
        ) : (
          <span className="pill">暂无</span>
        )}
      </div>
      <div className="detail-section">
        <h4>操作记录</h4>
        {t.logs.length ? (
          t.logs
            .slice()
            .reverse()
            .map((l, i) => (
              <div className="log-item" key={i}>
                {fmtTime(l.createdAt)} · {l.userName} · {l.action}
                {l.detail ? ' — ' + l.detail : ''}
              </div>
            ))
        ) : (
          <span className="pill">暂无</span>
        )}
      </div>
      <div className="detail-section">
        <h4>评论沟通区（{t.comments.length}）</h4>
        <div id="comment-list">
          {t.comments.length ? (
            t.comments.map((c) => (
              <div className="comment" key={c.id}>
                <span className="who">{c.userName}</span>
                <span className="when">{fmtTime(c.createdAt)}</span>
                <div style={{ marginTop: 4 }}>{c.content}</div>
              </div>
            ))
          ) : (
            <span className="pill">暂无评论</span>
          )}
        </div>
        <div className="repeat-row" style={{ marginTop: 10 }}>
          <InputArea
            placeholder="输入评论…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ minHeight: 60 }}
          />
          <Button variant="primary" size="sm" onClick={sendComment}>发送</Button>
        </div>
      </div>

      <div className="actions">{actions}</div>

      {claimOpen && <ClaimModal id={id} preset={t.workType} onClose={() => setClaimOpen(false)} onDone={reload} />}
      {copyOpen && <SubmitCopyModal id={id} initial={t.copyText} onClose={() => setCopyOpen(false)} onDone={reload} />}
      {videoOpen && (
        <SubmitVideoModal id={id} initial={t.videoLink || ''} initialType={t.videoType || ''} onClose={() => setVideoOpen(false)} onDone={reload} />
      )}
      {discardOpen && (
        <DiscardModal
          op={discardOpen}
          onClose={() => setDiscardOpen(null)}
          onDone={() => {
            onClose();
            refreshView();
            refreshPending();
          }}
          id={id}
        />
      )}
    </Modal>
  );
}

function ClaimModal({ id, preset, onClose, onDone }: { id: number; preset: string | null; onClose: () => void; onDone: () => void }) {
  const { toast, refreshView, refreshPending } = useApp();
  const [wt, setWt] = useState(preset === 'copywriting' ? 'copywriting' : 'full');
  return (
    <Modal title="选择接单类型" onClose={onClose}>
      <div className="field">
        <label>接单类型</label>
        <select value={wt} onChange={(e) => setWt(e.target.value)} style={{ width: '100%', padding: 11, borderRadius: 12, border: '1px solid var(--line)' }}>
          <option value="full">全流程（文案+视频）· 单价 ¥40</option>
          <option value="copywriting">仅文案 · 单价 ¥15</option>
        </select>
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await topicApi.claim(id, wt as WorkType);
              toast('已认领');
              onDone();
              refreshView();
              refreshPending();
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : '认领失败');
            }
          }}
        >
          确认认领
        </Button>
      </div>
    </Modal>
  );
}

function SubmitCopyModal({ id, initial, onClose, onDone }: { id: number; initial: string; onClose: () => void; onDone: () => void }) {
  const { toast, refreshView, refreshPending } = useApp();
  const [copy, setCopy] = useState(initial || '');
  return (
    <Modal title="提交文案审核" onClose={onClose}>
      <p style={{ color: 'var(--ink-2)', marginTop: 0 }}>请确认 / 补全文案内容，提交后由管理员审核：</p>
      <div className="field">
        <label>文案内容（可复制 / 编辑）</label>
        <InputArea value={copy} onChange={(e) => setCopy(e.target.value)} style={{ minHeight: 220, fontSize: 13 }} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await topicApi.submitCopy(id, copy);
              toast('已提交文案审核');
              onDone();
              refreshView();
              refreshPending();
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : '提交失败');
            }
          }}
        >
          提交审核
        </Button>
      </div>
    </Modal>
  );
}

function SubmitVideoModal({
  id,
  initial,
  initialType,
  onClose,
  onDone,
}: {
  id: number;
  initial: string;
  initialType: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast, refreshView, refreshPending } = useApp();
  const [mode, setMode] = useState<'import' | 'offline'>('import');
  const [link, setLink] = useState(initial && initialType === 'import' ? initial : '');
  const [uploaded, setUploaded] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="提交视频审核" onClose={onClose}>
      <p style={{ color: 'var(--ink-2)', marginTop: 0 }}>提交方式：</p>
      <div className="seg">
        <label className="seg-item">
          <input type="radio" name="sv-mode" checked={mode === 'import'} onChange={() => setMode('import')} /> 导入视频链接（走审核）
        </label>
        <label className="seg-item">
          <input type="radio" name="sv-mode" checked={mode === 'offline'} onChange={() => setMode('offline')} /> 上传线下视频文件（已确认过审，直接完结）
        </label>
      </div>
      {mode === 'import' ? (
        <div className="field">
          <label>视频链接（必填）</label>
          <input className="grow" style={{ width: '100%', padding: 11, borderRadius: 12, border: '1px solid var(--line)' }} placeholder="https:// 或 v.douyin.com/xxx" value={link} onChange={(e) => setLink(e.target.value)} />
        </div>
      ) : (
        <div className="field">
          <label>选取线下视频文件（上传后直接完结）</label>
          <input
            type="file"
            accept="video/*"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              try {
                const fd = new FormData();
                fd.append('file', f);
                const r = await (await import('../api')).uploadApi.video(fd);
                setUploaded(r.url);
                toast('视频已上传');
              } catch (err) {
                toast(err instanceof Error ? err.message : '上传失败');
              } finally {
                setBusy(false);
              }
            }}
          />
          {uploaded && <video src={uploaded} controls style={{ width: '100%', borderRadius: 10, maxHeight: 240, background: '#000', marginTop: 10 }} />}
        </div>
      )}
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            try {
              if (mode === 'import') {
                if (!link.trim()) return toast('请填写视频链接');
                await topicApi.submitVideo(id, { submitMode: 'import', videoLink: link.trim() });
                toast('已提交视频审核');
              } else {
                if (!uploaded) return toast('请先选取并上传线下视频文件');
                await topicApi.submitVideo(id, { submitMode: 'offline', videoLink: uploaded });
                toast('已线下过审并完结');
              }
              onDone();
              refreshView();
              refreshPending();
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : '提交失败');
            }
          }}
        >
          提交
        </Button>
      </div>
    </Modal>
  );
}

function DiscardModal({
  id,
  op,
  onClose,
  onDone,
}: {
  id: number;
  op: 'discard' | 'remove';
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast, refreshPending } = useApp();
  const [days, setDays] = useState('30');
  const [custom, setCustom] = useState('');
  const txt = op === 'discard' ? '废弃' : '删除';
  return (
    <Modal title={`${txt}选题`} onClose={onClose}>
      <p style={{ color: 'var(--ink-2)', marginTop: 0 }}>该选题将进入回收站，过期后自动永久清除。请选择保留天数：</p>
      <div className="field">
        <label>回收站保留天数</label>
        <select value={days} onChange={(e) => setDays(e.target.value)} style={{ width: '100%', padding: 11, borderRadius: 12, border: '1px solid var(--line)' }}>
          <option value="7">7 天</option>
          <option value="14">14 天</option>
          <option value="28">28 天</option>
          <option value="30">30 天（默认）</option>
          <option value="custom">自定义…</option>
        </select>
      </div>
      {days === 'custom' && (
        <div className="field">
          <label>自定义天数（1-365）</label>
          <input type="number" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ width: '100%', padding: 11, borderRadius: 12, border: '1px solid var(--line)' }} />
        </div>
      )}
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="destructive"
          onClick={async () => {
            let d = parseInt(days, 10);
            if (days === 'custom') d = parseInt(custom, 10) || 0;
            if (!(d >= 1 && d <= 365)) return toast('请填写 1-365 之间的天数');
            try {
              if (op === 'discard') await topicApi.discard(id, d);
              else await topicApi.remove(id, d);
              toast(`已${txt}，进入回收站`);
              onDone();
              refreshPending();
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : '操作失败');
            }
          }}
        >
          确认{txt}
        </Button>
      </div>
    </Modal>
  );
}
