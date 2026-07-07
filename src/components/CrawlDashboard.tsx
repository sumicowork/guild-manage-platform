'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface CrawlTask {
  id: number;
  type: string;
  status: string;
  trigger: string;
  startedAt: string | null;
  completedAt?: string | null;
  stats?: Record<string, any>;
  errorMessage?: string | null;
}

const typeLabels: Record<string, string> = {
  full: '全量爬取', update: '增量更新', members: '爬取成员',
};

const phaseLabels: Record<string, string> = {
  feeds: '帖子', comments: '评论', details: '详情', members: '成员', scan: '扫描',
};

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60}s`;
  return `${(sec / 3600).toFixed(1)}h`;
}

export function CrawlDashboard() {
  const [tasks, setTasks] = useState<CrawlTask[]>([]);

  const fetchTasks = useCallback(async () => {
    try {
      // Fetch latest per type — avoids being buried by minutely cron tasks
      const results = await Promise.all(
        ['full', 'update', 'members'].map(type =>
          api.get<{ data: CrawlTask[] }>(`/crawl/tasks?pageSize=1&type=${type}`)
        )
      );
      const tasks = results.flatMap(r => r.data || []);
      setTasks(tasks);
    } catch { /* ignore — SSE retries on next event */ }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // SSE: live updates
  useEffect(() => {
    const es = new EventSource('/api/crawl/stream');
    es.addEventListener('update', () => { fetchTasks(); });
    es.addEventListener('status', () => { fetchTasks(); });
    return () => es.close();
  }, [fetchTasks]);

  const types = ['full', 'update', 'members'] as const;
  const typeIcons: Record<string, string> = { full: '全量爬取', update: '增量更新', members: '爬取成员' };

  const taskByType = new Map<string, CrawlTask>();
  for (const t of tasks) taskByType.set(t.type, t);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {types.map(type => {
        const task = taskByType.get(type);
        if (!task) return (
          <Card key={type} className="border-gray-100">
            <CardContent className="p-4 text-center text-sm text-gray-400">{typeIcons[type]}</CardContent>
          </Card>
        );

        const stats = task.stats || {};
        const timing = stats.timing as Record<string, any> | undefined;
        const rateLimits = stats.rateLimits as Record<string, number> | undefined;
        const wallTime = stats.wallTimeSec as number | undefined
          || (timing ? Math.round((Object.values(timing).reduce((max, t) => Math.max(max, (t.ended || Date.now()) - t.started), 0)) / 1000) : undefined);
        const elapsed = task.startedAt ? Math.round((Date.now() - new Date(task.startedAt).getTime()) / 1000) : 0;
        const total153 = rateLimits ? Object.values(rateLimits).reduce((a, b) => a + b, 0) : 0;
        const isRunning = task.status === 'running';
        const isFailed = task.status === 'failed';

        return (
          <Card key={type} className={
            isRunning ? 'border-blue-200 bg-gradient-to-r from-blue-50/50 to-white' :
            isFailed ? 'border-red-200 bg-gradient-to-r from-red-50/50 to-white' :
            'border-green-200 bg-gradient-to-r from-green-50/50 to-white'
          }>
            <CardHeader className="pb-1.5">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <span className={`inline-block size-2 rounded-full ${isRunning ? 'bg-blue-500 animate-pulse' : isFailed ? 'bg-red-500' : 'bg-green-500'}`} />
                <span className="text-gray-700">{typeIcons[type] || type}</span>
                <span className={`text-xs font-normal ml-1 ${isRunning ? 'text-blue-600' : isFailed ? 'text-red-600' : 'text-green-600'}`}>
                  {isRunning ? '运行中' : isFailed ? '失败' : '已完成'}
                </span>
                <span className="ml-auto text-xs font-normal text-gray-400">
                  {isRunning ? fmtDuration(elapsed) : (wallTime ? fmtDuration(wallTime) : '')}
                  {total153 > 0 && <span className="ml-1 text-orange-500">⚠153×{total153}</span>}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {timing && Object.entries(timing).map(([p, t]) => {
                const dur = ((t.ended || Date.now()) - t.started) / 1000;
                const avgMs = t.calls > 0 ? dur * 1000 / t.calls : 0;
                const done = !!t.ended;
                const hasProgress = (t.total ?? 0) > 0 && t.current != null;
                const pct = done ? 100 : (hasProgress ? Math.min(99, Math.round(t.current! / t.total! * 100)) : Math.min(99, (t.calls % 1000) / 10));
                const progressLabel = hasProgress ? `${t.current}/${t.total}` : (done ? '完成' : '—');
                return (
                  <div key={p} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-500">{phaseLabels[p] || p}<span className="text-gray-300 ml-1">{progressLabel}</span></span>
                      <span className="font-mono text-gray-400">{done ? `✓ ${t.calls}次·${avgMs.toFixed(0)}ms` : t.calls > 0 ? `${t.calls}次·${avgMs.toFixed(0)}ms` : '—'}</span>
                    </div>
                    <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${done ? 'bg-green-400' : isRunning ? 'bg-blue-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-gray-400 pt-1 border-t border-gray-50">
                {stats.feedsTotal != null && <span>帖子<b className="text-gray-600 ml-0.5">{stats.feedsTotal}</b></span>}
                {stats.commentsTotal != null && <span>评论<b className="text-gray-600 ml-0.5">{stats.commentsTotal}</b></span>}
                {stats.detailsTotal != null && <span>详情<b className="text-gray-600 ml-0.5">{stats.detailsTotal}</b></span>}
                {stats.membersTotal != null && <span>成员<b className="text-gray-600 ml-0.5">{stats.membersTotal}</b></span>}
                {stats.newFeeds != null && <span>新帖<b className="text-green-600 ml-0.5">{stats.newFeeds}</b></span>}
                {stats.updatedFeeds != null && <span>更新<b className="text-blue-600 ml-0.5">{stats.updatedFeeds}</b></span>}
                {stats.commentsAdded != null && <span>新评<b className="text-cyan-600 ml-0.5">{stats.commentsAdded}</b></span>}
                {stats.newMembers != null && <span>新成员<b className="text-green-600 ml-0.5">{stats.newMembers}</b></span>}
                {stats.autoActions > 0 && <span>自动<b className="text-purple-500 ml-0.5">{stats.autoActions}</b></span>}
                {stats.errors > 0 && <span className="text-red-500">错误<b className="ml-0.5">{stats.errors}</b></span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
