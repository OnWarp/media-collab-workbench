import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button, Input, Select } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import type { ViewId } from '../app-context';
import { boardApi, topicApi } from '../api';
import type { Board as BoardT, Topic, UserProgress } from '../types';
import { Loading } from '../components/common';
import { TopicCard } from '../components/TopicCard';

export function Board() {
  const { openModal, navigate, pending, toast, refreshView, me } = useApp();
  const [board, setBoard] = useState<BoardT>({ notice: '', referenceVideos: [] });
  const [topics, setTopics] = useState<Topic[]>([]);
  const [progress, setProgress] = useState<Record<number, UserProgress>>({});
  const [loading, setLoading] = useState(true);
  const [favOnly, setFavOnly] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    stage: '',
    workType: '',
    settlement: '',
    sort: 'updated',
  });
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [boardData, topicList] = await Promise.all([
        boardApi.get().catch(() => ({ notice: '', referenceVideos: [] })),
        (async () => {
          const q: Record<string, unknown> = {};
          if (debouncedKeyword) q.keyword = debouncedKeyword;
          if (filters.status) q.status = filters.status;
          if (filters.stage) q.stage = filters.stage;
          if (filters.workType) q.workType = filters.workType;
          if (filters.settlement) q.settlement = filters.settlement;
          if (filters.sort) q.sort = filters.sort;
          if (favOnly) q.favorite = true;
          return topicApi.list(q);
        })(),
      ]);
      setBoard(boardData);
      setTopics(topicList);
      // Build progress from topic list (no extra API call)
      const byUser: Record<number, { name: string; total: number; byStatus: Record<string, number>; inProgress: Topic[] }> = {};
      topicList.forEach((t) => {
        if (!t.claimerId) return;
        const u =
          byUser[t.claimerId] ||
          (byUser[t.claimerId] = {
            name: t.claimerName,
            total: 0,
            byStatus: { pending: 0, in_progress: 0, review: 0, finished: 0 },
            inProgress: [],
          });
        u.total++;
        u.byStatus[t.status] = (u.byStatus[t.status] || 0) + 1;
        if (t.status === 'in_progress' || t.status === 'review') u.inProgress.push(t);
      });
      setProgress(byUser);
    } catch (e) {
      toast(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshView, favOnly, debouncedKeyword, filters]);

  const isAdmin = me?.role === 'admin';

  return (
    <div>
      {/* 公告看板 */}
      <div className="board-announce">
        <div className="ba-head">
          <span className="ba-title">📺 参考视频栏</span>
          {isAdmin && (
            <Button size="sm" onClick={() => openModal({ type: 'boardEdit' })}>
              ✎ 编辑公告栏
            </Button>
          )}
        </div>
        {board.notice && <div className="ba-notice">{board.notice}</div>}
        <div className="ba-videos">
          {board.referenceVideos.length ? (
            board.referenceVideos.map((v, i) => (
              <a className="ba-video" key={i} href={v.url} target="_blank" rel="noopener">
                ▶ {v.title || v.url}
              </a>
            ))
          ) : (
            <span className="pill">暂无参考视频</span>
          )}
        </div>
      </div>

      {/* 接单看板 */}
      <div className="prog-wrap">
        <div className="sec-title">
          用户接单看板 <span className="muted" style={{ fontWeight: 400 }}>（各成员当前进度）</span>
        </div>
        <div className="prog-board" id="progress-board">
          {Object.values(progress).length ? (
            Object.values(progress).map((u: any, i) => (
              <div className="prog-card" key={i}>
                <div className="prog-head">
                  <span className="prog-avatar">{(u.name || '?').slice(0, 1)}</span>
                  <b>{u.name || '?'}</b>
                  <span className="prog-total">接单 {u.total}</span>
                </div>
                <div className="prog-bars">
                  <span className="tag in_progress">制作中 {u.byStatus.in_progress}</span>
                  <span className="tag review">待审 {u.byStatus.review}</span>
                  <span className="tag finished">已完结 {u.byStatus.finished}</span>
                </div>
                {u.inProgress.length ? (
                  <div className="prog-ip">
                    {u.inProgress.map((t: Topic) => (
                      <span
                        className="prog-chip"
                        key={t.id}
                        onClick={() => openModal({ type: 'topic', id: t.id })}
                      >
                        {t.title} · {t.stageLabel}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: 8 }}>
                    暂无进行中选题
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="empty">暂无成员接单</div>
          )}
        </div>
      </div>

      {/* 待办提醒 */}
      <RemindStrip />

      {/* 筛选 */}
      <div className="toolbar">
        <Input
          placeholder="搜索标题/简介"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if ((e as KeyboardEvent<HTMLInputElement>).key === 'Enter') loadAll();
          }}
        />
        <Select
          aria-label="状态"
          placeholder="全部状态"
          value={filters.status}
          onValueChange={(v) => setFilters({ ...filters, status: v as string })}
          items={{
            '': '全部状态',
            pending: '待认领',
            in_progress: '制作中',
            review: '待审核',
            finished: '已完结',
          }}
        />
        <Select
          aria-label="阶段"
          placeholder="全部阶段"
          value={filters.stage}
          onValueChange={(v) => setFilters({ ...filters, stage: v as string })}
          items={{
            '': '全部阶段',
            confirm: '确认选题',
            copywriting: '文案制作',
            video: '视频制作',
            done: '完结',
          }}
        />
        <Select
          aria-label="类型"
          placeholder="全部类型"
          value={filters.workType}
          onValueChange={(v) => setFilters({ ...filters, workType: v as string })}
          items={{ '': '全部类型', full: '全流程', copywriting: '仅文案' }}
        />
        <Select
          aria-label="结款"
          placeholder="全部结款"
          value={filters.settlement}
          onValueChange={(v) => setFilters({ ...filters, settlement: v as string })}
          items={{ '': '全部结款', unsettled: '待结算', settled: '已结算' }}
        />
        <Select
          aria-label="排序"
          placeholder="最近更新"
          value={filters.sort}
          onValueChange={(v) => setFilters({ ...filters, sort: v as string })}
          items={{
            updated: '最近更新',
            library_desc: '在库最久',
            library_asc: '最新入库',
          }}
        />
        <Button size="sm" onClick={loadAll}>
          筛选
        </Button>
        <div className="spacer" />
        <Button
          size="sm"
          variant={favOnly ? 'primary' : 'secondary'}
          onClick={() => setFavOnly((f) => !f)}
        >
          ★ 我的收藏
        </Button>
      </div>

      {loading ? (
        <Loading />
      ) : (
        <div className="grid">
          {topics.length ? (
            topics.map((t) => (
              <TopicCard key={t.id} t={t} onClick={() => openModal({ type: 'topic', id: t.id })} />
            ))
      ) : (
        <div className="empty">暂无选题</div>
      )}
      </div>
      )}
    </div>
  );
}

function RemindStrip() {
  const { pending, navigate, me } = useApp();
  if (!pending) return <div className="remind-strip" />;
  const parts: { label: string; go: ViewId; warn?: boolean }[] = [];
  if (pending.pendingClaim)
    parts.push({ label: `📝 待认领 ${pending.pendingClaim}`, go: 'market' });
  if (me?.role === 'admin') {
    if (pending.review) parts.push({ label: `✅ 待审核 ${pending.review}`, go: 'review' });
    if (pending.pendingSettle)
      parts.push({ label: `💰 待结算 ${pending.pendingSettle}`, go: 'review', warn: true });
  }
  if (!parts.length)
    return (
      <div className="remind-strip">
        <span className="remind-ok">✅ 当前没有待处理事项</span>
      </div>
    );
  return (
    <div className="remind-strip">
      <span className="remind-label">待办提醒：</span>
      {parts.map((p, i) => (
        <span
          key={i}
          className={'remind-pill' + (p.warn ? ' warn' : '')}
          onClick={() => navigate(p.go)}
        >
          <b>{p.label}</b>
        </span>
      ))}
    </div>
  );
}
