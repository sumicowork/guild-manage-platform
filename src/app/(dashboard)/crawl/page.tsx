'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import { DataTable, Column } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { RefreshCw, Download, Users, Loader2, Clock, Save } from 'lucide-react';
import { useSelectedIdentity } from '@/contexts/SelectedIdentityContext';

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
};

const statusLabels: Record<string, string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  pending: '等待中',
};

const triggerLabels: Record<string, string> = {
  manual: '手动',
  cron: '定时',
  scheduled: '定时',
  auto: '自动',
};

/** Render stats flexibly based on crawl type */
function renderStats(stats: Record<string, any> | undefined) {
  if (!stats) return <span className="text-xs text-gray-400">-</span>;

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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { selectedIdentityId } = useSelectedIdentity();

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
  }, [fetchTasks, fetchSchedule]);

  // Auto-refresh when a task is running
  useEffect(() => {
    const hasRunning = tasks.some((t) => t.status === 'running');
    if (hasRunning) {
      intervalRef.current = setInterval(fetchTasks, 5000);
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
      await api.post('/crawl/trigger', { type, adminIdentityId: selectedIdentityId ?? undefined });
      toast.success('任务已触发');
      fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发失败');
    } finally {
      setTriggering(null);
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
      render: (t) => renderStats(t.stats),
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
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">爬取管理</h2>
        <div className="flex items-center gap-2">
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
