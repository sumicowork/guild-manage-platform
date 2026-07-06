'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import { DataTable, Column } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { RefreshCw, Download, Users, Loader2, Clock, Save, Square } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';

interface AdminIdentity {
  id: number;
  name: string;
}

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

interface CrawlListResponse {
  data: CrawlTask[];
  total: number;
}

interface ScheduleInfo {
  updateCron: string;
  memberCron: string;
}

const typeLabels: Record<string, string> = {
  full: '全量爬取',
  update: '增量更新',
  incremental: '增量更新',
  members: '爬取成员',
};

const statusColors: Record<string, string> = {
  running: 'bg-blue-50 text-blue-600',
  completed: 'bg-green-50 text-green-600',
  failed: 'bg-red-50 text-red-600',
  pending: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-orange-50 text-orange-600',
  interrupted: 'bg-orange-50 text-orange-600',
};

const statusLabels: Record<string, string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  pending: '等待中',
  cancelled: '已取消',
  interrupted: '已中断',
};

const triggerLabels: Record<string, string> = {
  manual: '手动',
  cron: '定时',
  scheduled: '定时',
  auto: '自动',
};

const phaseLabels: Record<string, string> = { feeds: '帖子', comments: '评论', details: '详情', members: '成员' };

function SpeedReport({ timing, wallTime, rateLimits, status }: {
  timing: Record<string, { started: number; ended?: number; calls: number; current?: number; total?: number }>;
  wallTime?: number;
  rateLimits?: Record<string, number>;
  status?: string;
}) {
  const phases = Object.entries(timing);
  if (phases.length === 0) return <span className="text-xs text-gray-400">-</span>;

  const total153 = rateLimits ? Object.values(rateLimits).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-1 min-w-[200px]">
      {wallTime != null && (
        <div className="text-xs text-gray-500">
          总耗时 <span className="font-mono font-medium text-gray-700">{fmtDuration(wallTime)}</span>
          {total153 > 0 && <span className="ml-2 text-orange-500">⚠ 153×{total153}</span>}
        </div>
      )}
      {phases.map(([phase, t]) => {
        const dur = ((t.ended || Date.now()) - t.started) / 1000;
        const avgMs = t.calls > 0 ? (dur * 1000 / t.calls) : 0;
        const running = !t.ended && status === 'running';
        return (
          <div key={phase} className="flex items-center gap-1.5 text-xs">
            <span className="w-8 text-gray-400">{phaseLabels[phase] || phase}</span>
            <span className={`font-mono font-medium ${running ? 'text-blue-600' : 'text-gray-700'}`}>
              {t.calls}次
            </span>
            <span className="text-gray-400">·</span>
            <span className="font-mono text-gray-500">{avgMs.toFixed(0)}ms</span>
            {running && <span className="ml-auto inline-block size-1.5 rounded-full bg-blue-400 animate-pulse" />}
          </div>
        );
      })}
    </div>
  );
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60}s`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function LiveCrawlDashboard({ tasks }: { tasks: CrawlTask[] }) {
  const running = tasks.filter(t => t.status === 'running');
  // Show running tasks, or if none, the most recent completed/failed one
  const display = running.length > 0 ? running : (() => {
    const recent = tasks.filter(t => t.status === 'completed' || t.status === 'failed')
      .sort((a, b) => b.id - a.id);
    return recent.length > 0 ? [recent[0]] : [];
  })();

  if (display.length === 0) return null;

  return (
    <div className="space-y-3">
      {display.map(task => {
        const stats = task.stats || {};
        const timing = stats.timing as Record<string, { started: number; ended?: number; calls: number; current?: number; total?: number }> | undefined;
        const wallTime = stats.wallTimeSec as number | undefined
          || (timing ? Math.round((Object.values(timing).reduce((max, t) => Math.max(max, (t.ended || Date.now()) - t.started), 0)) / 1000) : undefined);
        const rateLimits = stats.rateLimits as Record<string, number> | undefined;
        const phase = stats.phase as string || '';
        const elapsed = task.startedAt ? Math.round((Date.now() - new Date(task.startedAt).getTime()) / 1000) : 0;
        const total153 = rateLimits ? Object.values(rateLimits).reduce((a, b) => a + b, 0) : 0;

        // Compute progress for full crawl
        const feedsMax = stats.feedsTotal || 0;
        const detailProgress = feedsMax > 0 ? (stats.detailsTotal || 0) / feedsMax * 100 : 0;
        const commentProgress = stats.commentRefTotal || (stats.commentsTotal && timing?.comments?.ended ? 100 : timing ? 99 : 0);

        const isRunning = task.status === 'running';
        const statusColor = isRunning ? 'border-blue-200 bg-gradient-to-r from-blue-50/50 to-white' :
                            task.status === 'failed' ? 'border-red-200 bg-gradient-to-r from-red-50/50 to-white' :
                            'border-green-200 bg-gradient-to-r from-green-50/50 to-white';
        const statusBadge = isRunning ? '运行中' : task.status === 'failed' ? '失败' : '已完成';
        const badgeColor = isRunning ? 'text-blue-600' : task.status === 'failed' ? 'text-red-600' : 'text-green-600';
        const dotColor = isRunning ? 'bg-blue-500 animate-pulse' : task.status === 'failed' ? 'bg-red-500' : 'bg-green-500';

        return (
          <Card key={task.id} className={statusColor}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className={`inline-block size-2 rounded-full ${dotColor}`} />
                {typeLabels[task.type] || task.type} · <span className={badgeColor}>{statusBadge}</span>
                <span className="ml-auto text-sm font-normal text-gray-500">
                  {isRunning ? `已运行 ${fmtDuration(elapsed)}` : (wallTime ? `总耗时 ${fmtDuration(wallTime)}` : '')}
                  {total153 > 0 && <span className="ml-2 text-orange-500 font-medium">⚠ 153×{total153}</span>}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Phase progress bars */}
              {timing && Object.entries(timing).map(([p, t]) => {
                const dur = ((t.ended || Date.now()) - t.started) / 1000;
                const avgMs = t.calls > 0 ? dur * 1000 / t.calls : 0;
                const cpm = dur > 0 ? (t.calls / dur * 60 | 0) : 0;
                const done = !!t.ended;
                const hasProgress = (t.total ?? 0) > 0 && t.current != null;
                const pct = done ? 100 : (hasProgress ? Math.min(99, Math.round(t.current! / t.total! * 100)) : Math.min(99, (t.calls % 1000) / 10));
                return (
                  <div key={p} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-600">
                        {phaseLabels[p] || p}
                        {done && <span className="ml-1 text-gray-400 font-normal">{fmtDuration(dur)}</span>}
                      </span>
                      <span className="font-mono text-gray-500">
                        {done ? (
                          <span className="text-green-600">✓ {t.calls}次 · {avgMs.toFixed(0)}ms/次 · {cpm}/min</span>
                        ) : (
                          <span className="text-blue-600">{t.calls}次 · {avgMs.toFixed(0)}ms</span>
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${done ? 'bg-green-400' : isRunning ? 'bg-blue-400 animate-pulse' : 'bg-red-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Summary row */}
              <div className="flex flex-wrap gap-3 text-xs text-gray-500 pt-1.5 border-t border-gray-100">
                {stats.feedsTotal != null && <span>帖子 <b className="text-gray-700">{stats.feedsTotal}</b></span>}
                {stats.commentsTotal != null && <span>评论 <b className="text-gray-700">{stats.commentsTotal}</b></span>}
                {stats.detailsTotal != null && <span>详情 <b className="text-gray-700">{stats.detailsTotal}</b></span>}
                {stats.membersTotal != null && <span>成员 <b className="text-gray-700">{stats.membersTotal}</b></span>}
                {stats.newFeeds != null && <span>新帖 <b className="text-green-600">{stats.newFeeds}</b></span>}
                {stats.updatedFeeds != null && <span>更新 <b className="text-blue-600">{stats.updatedFeeds}</b></span>}
                {stats.commentsAdded != null && <span>新评论 <b className="text-cyan-600">{stats.commentsAdded}</b></span>}
                {stats.newMembers != null && <span>新成员 <b className="text-green-600">{stats.newMembers}</b></span>}
                {stats.autoActions > 0 && <span className="text-purple-500">自动操作 <b>{stats.autoActions}</b></span>}
                {stats.errors > 0 && <span className="text-red-500">错误 <b>{stats.errors}</b></span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
function renderStats(stats: Record<string, any> | undefined, taskStatus?: string) {
  if (!stats) return <span className="text-xs text-gray-400">-</span>;

  const timing = stats.timing as Record<string, { started: number; ended?: number; calls: number; current?: number; total?: number }> | undefined;
  const wallTime = stats.wallTimeSec as number | undefined;

  // ── Speed report (when timing data available) ──
  if (timing && Object.keys(timing).length > 0) {
    return <SpeedReport timing={timing} wallTime={wallTime} rateLimits={stats.rateLimits} status={taskStatus} />;
  }

  // ── Legacy: simple stat badges ──
  const items: { label: string; value: number; color: string }[] = [];

  // Full crawl stats
  if (stats.feedsTotal !== undefined) items.push({ label: '帖子', value: stats.feedsTotal, color: 'text-blue-600' });
  if (stats.commentsTotal !== undefined) items.push({ label: '评论', value: stats.commentsTotal, color: 'text-cyan-600' });
  if (stats.detailsTotal !== undefined) items.push({ label: '详情', value: stats.detailsTotal, color: 'text-indigo-600' });
  if (stats.membersTotal !== undefined) items.push({ label: '成员', value: stats.membersTotal, color: 'text-purple-600' });

  // Update crawl stats
  if (stats.newFeeds !== undefined) items.push({ label: '新帖', value: stats.newFeeds, color: 'text-green-600' });
  if (stats.updatedFeeds !== undefined) items.push({ label: '更新帖', value: stats.updatedFeeds, color: 'text-blue-600' });
  if (stats.commentsAdded !== undefined) items.push({ label: '新评论', value: stats.commentsAdded, color: 'text-cyan-600' });

  // Member crawl stats
  if (stats.newMembers !== undefined) items.push({ label: '新成员', value: stats.newMembers, color: 'text-green-600' });
  if (stats.membersLeft !== undefined) items.push({ label: '离开', value: stats.membersLeft, color: 'text-orange-600' });

  // Deletion detection
  if (stats.deletions) {
    const d = stats.deletions;
    if (d.feedsDeleted > 0) items.push({ label: '删帖', value: d.feedsDeleted, color: 'text-red-500' });
    if (d.commentsDeleted > 0) items.push({ label: '删评论', value: d.commentsDeleted, color: 'text-red-500' });
  }

  // Errors always shown if > 0
  if (stats.errors > 0) items.push({ label: '错误', value: stats.errors, color: 'text-red-600' });

  if (items.length === 0) return <span className="text-xs text-gray-400">-</span>;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
      {items.map((item, i) => (
        <span key={i}>
          {item.label}: <span className={`font-medium ${item.color}`}>{item.value}</span>
        </span>
      ))}
    </div>
  );
}

/** Safe date formatting, handles null/undefined/Invalid Date */
function formatDate(d: string | null | undefined): string {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
}

export default function CrawlPage() {
  const [tasks, setTasks] = useState<CrawlTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [identities, setIdentities] = useState<AdminIdentity[]>([]);
  const [adminIdentityId, setAdminIdentityId] = useState<string>('');

  // Schedule state
  const [schedule, setSchedule] = useState<ScheduleInfo | null>(null);
  const [editUpdateCron, setEditUpdateCron] = useState('');
  const [editMemberCron, setEditMemberCron] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const result = await api.get<CrawlListResponse>('/crawl/tasks');
      setTasks(result.data);
      setTotal(result.total);
    } catch {
      toast.error('获取爬取任务失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSchedule = useCallback(async () => {
    try {
      const result = await api.get<ScheduleInfo>('/crawl/schedule');
      setSchedule(result);
      setEditUpdateCron(result.updateCron || '');
      setEditMemberCron(result.memberCron || '');
    } catch {
      // Schedule fetch failure is non-critical
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchSchedule();
    // 加载管理员身份列表
    api.get<AdminIdentity[]>('/admin-identities').then((data) => {
      setIdentities(data);
    }).catch(() => {});
  }, [fetchTasks, fetchSchedule]);

  // Auto-refresh when a task is running
  useEffect(() => {
    const hasRunning = tasks.some((t) => t.status === 'running');
    if (hasRunning) {
      intervalRef.current = setInterval(fetchTasks, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tasks, fetchTasks]);

  const triggerTask = async (type: string) => {
    setTriggering(type);
    try {
      await api.post('/crawl/trigger', { type, adminIdentityId: adminIdentityId ? Number(adminIdentityId) : undefined });
      toast.success('任务已触发');
      fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发失败');
    } finally {
      setTriggering(null);
    }
  };

  const cancelTask = async (taskId: number) => {
    setCancellingId(taskId);
    try {
      const result = await api.post<{ cancelled: boolean; message?: string; reason?: string }>('/crawl/cancel', { taskId: String(taskId) });
      if (result.cancelled) {
        toast.success(result.message || '已发出取消信号');
      } else {
        toast.info(result.message || `任务无法取消：${result.reason || '未知原因'}`);
      }
      fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取消失败');
    } finally {
      setCancellingId(null);
    }
  };

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      await api.put('/crawl/schedule', {
        updateCron: editUpdateCron,
        memberCron: editMemberCron,
      });
      toast.success('调度配置已保存');
      fetchSchedule();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingSchedule(false);
    }
  };

  const columns: Column<CrawlTask>[] = [
    {
      key: 'type',
      header: '类型',
      width: '100px',
      render: (t) => <span className="text-gray-700">{typeLabels[t.type] || t.type}</span>,
    },
    {
      key: 'status',
      header: '状态',
      width: '90px',
      render: (t) => (
        <Badge className={statusColors[t.status] || 'bg-gray-200 text-gray-700'}>
          {statusLabels[t.status] || t.status}
        </Badge>
      ),
    },
    {
      key: 'trigger',
      header: '触发方式',
      width: '80px',
      render: (t) => <span className="text-xs text-gray-500">{triggerLabels[t.trigger] || t.trigger}</span>,
    },
    {
      key: 'startedAt',
      header: '开始时间',
      width: '160px',
      render: (t) => (
        <span className="text-xs text-gray-500">{formatDate(t.startedAt)}</span>
      ),
    },
    {
      key: 'completedAt',
      header: '结束时间',
      width: '160px',
      render: (t) => (
        <span className="text-xs text-gray-500">{formatDate(t.completedAt)}</span>
      ),
    },
    {
      key: 'stats',
      header: '统计',
      render: (t) => renderStats(t.stats, t.status),
    },
    {
      key: 'error',
      header: '错误信息',
      width: '200px',
      render: (t) =>
        t.errorMessage ? (
          <span className="block max-w-[200px] truncate text-xs text-red-500" title={t.errorMessage}>
            {t.errorMessage}
          </span>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        ),
    },
    {
      key: 'actions',
      header: '操作',
      width: '90px',
      render: (t) =>
        t.status === 'running' || t.status === 'pending' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => cancelTask(t.id)}
            disabled={cancellingId === t.id}
            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200"
          >
            {cancellingId === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
            停止
          </Button>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">爬取管理</h2>
        <div className="flex items-center gap-2">
          <Select value={adminIdentityId} onValueChange={(v) => setAdminIdentityId(v ?? '')}>
            <SelectTrigger className="w-[180px]">
              <span className="text-sm truncate">{adminIdentityId ? (identities.find(i => String(i.id) === adminIdentityId)?.name || '操作身份') : '自动轮转'}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">自动轮转（推荐）</SelectItem>
              {identities.map((id) => (
                <SelectItem key={id.id} value={String(id.id)}>
                  {id.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerTask('full')}
            disabled={triggering !== null}
          >
            {triggering === 'full' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            全量爬取
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerTask('incremental')}
            disabled={triggering !== null}
          >
            {triggering === 'incremental' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            增量更新
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerTask('members')}
            disabled={triggering !== null}
          >
            {triggering === 'members' ? <Loader2 className="size-3.5 animate-spin" /> : <Users className="size-3.5" />}
            爬取成员
          </Button>
        </div>
      </div>

      {/* Live Dashboard */}
      <LiveCrawlDashboard tasks={tasks} />

      <DataTable
        columns={columns}
        data={tasks}
        loading={loading}
        rowKey={(t) => t.id}
        emptyText="暂无爬取任务"
      />

      {/* Schedule Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="size-4" />
            定时调度配置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">增量更新 Cron 表达式</label>
              <Input
                value={editUpdateCron}
                onChange={(e) => setEditUpdateCron(e.target.value)}
                placeholder="0 */6 * * *"
                className="font-mono text-sm"
              />
              {schedule && (
                <p className="text-xs text-gray-400">当前: {schedule.updateCron || '未设置'}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">成员爬取 Cron 表达式</label>
              <Input
                value={editMemberCron}
                onChange={(e) => setEditMemberCron(e.target.value)}
                placeholder="0 2 * * *"
                className="font-mono text-sm"
              />
              {schedule && (
                <p className="text-xs text-gray-400">当前: {schedule.memberCron || '未设置'}</p>
              )}
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              onClick={saveSchedule}
              disabled={savingSchedule}
            >
              {savingSchedule ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              保存配置
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
