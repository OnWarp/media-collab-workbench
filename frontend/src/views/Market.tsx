import { useEffect, useState } from 'react';
import { Button, Input, Select } from '@cloudflare/kumo';
import { useApp } from '../app-context';
import { seriesApi, topicApi, type TopicQuery } from '../api';
import type { SeriesItem, Topic } from '../types';
import { Loading } from '../components/common';
import { TopicCard } from '../components/TopicCard';

export function Market() {
  const { openModal, toast, refreshView } = useApp();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState('updated');
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    try {
      const q: TopicQuery = {};
      if (keyword) q.keyword = keyword;
      if (seriesFilter) q.series = seriesFilter;
      if (sort) q.sort = sort;
      const list = await topicApi.list(q);
      setTopics(list);
    } catch (e) {
      toast(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadSeries = async () => {
    try {
      setSeries(await seriesApi.list());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadSeries();
  }, []);

  useEffect(() => {
    loadAll();
  }, [refreshView, keyword, seriesFilter, sort]);

  return (
    <div>
      <div className="toolbar">
        <Input
          placeholder="搜索选题"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if ((e as React.KeyboardEvent).key === 'Enter') loadAll();
          }}
        />
        <Button size="sm" onClick={loadAll}>
          搜索
        </Button>
        <Select
          aria-label="排序"
          placeholder="最近更新"
          value={sort}
          onValueChange={(v) => setSort(v as string)}
          items={{
            updated: '最近更新',
            library_desc: '在库最久',
            library_asc: '最新入库',
          }}
        />
        <div className="spacer" />
        <Button variant="primary" onClick={() => openModal({ type: 'create' })}>
          ＋ 发布选题
        </Button>
      </div>

      {series.length > 0 && (
        <div className="series-bar">
          <div className="series-chips">
            {series.map((s) => (
              <span
                key={s.name}
                className={'series-chip' + (seriesFilter === s.name ? ' active' : '')}
                onClick={() => setSeriesFilter((f) => (f === s.name ? null : s.name))}
              >
                #{s.name} <b>{s.count}</b>
              </span>
            ))}
            {seriesFilter && (
              <span
                className="series-clear"
                onClick={() => setSeriesFilter(null)}
              >
                清除筛选 ✕
              </span>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : (
        <div className="grid">
          {topics.length ? (
            topics.map((t) => (
              <TopicCard key={t.id} t={t} onClick={() => openModal({ type: 'topic', id: t.id })} />
            ))
          ) : (
            <div className="empty">暂无选题，点右上角发布一个吧</div>
          )}
        </div>
      )}
    </div>
  );
}
