'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api-client';
import { DataTable, Column } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { RefreshCw, Download, Users, Loader2 } from 'lucide-react';

interface CrawlTask {
  id: number;
  type: string;
  status: string;
  trigger: string;
  startedAt: string;
  completedAt?: string;
  stats?: {
    feedsNew: number;
    feedsUpdated: number;
    commentsNew: number;
    errors: number;
  };
  errorMessage?: string;
}

interface CrawlListResponse {
  data: CrawlTask[];
  total: number;
}

const typeLabels: Record<string, string> = {
  full: '全量爬取',
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
  scheduled: '定时',
  auto: '自动',
};

export default function CrawlPage() {
  const [tasks, setTasks] = useState<CrawlTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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
      await api.post('/crawl/trigger', { type });
      toast.success('任务已触发');
      fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发失败');
    } finally {
      setTriggering(null);
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
        <span className="text-xs text-gray-500">
          {new Date(t.startedAt).toLocaleString('zh-CN')}
        </span>
      ),
    },
    {
      key: 'completedAt',
      header: '结束时间',
      width: '160px',
      render: (t) =>
        t.completedAt ? (
          <span className="text-xs text-gray-500">
            {new Date(t.completedAt).toLocaleString('zh-CN')}
          </span>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        ),
    },
    {
      key: 'stats',
      header: '统计',
      render: (t) =>
        t.stats ? (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>新增帖: <span className="text-green-400">{t.stats.feedsNew}</span></span>
            <span>更新帖: <span className="text-blue-400">{t.stats.feedsUpdated}</span></span>
            <span>新评论: <span className="text-cyan-400">{t.stats.commentsNew}</span></span>
            {t.stats.errors > 0 && (
              <span>错误: <span className="text-red-400">{t.stats.errors}</span></span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        ),
    },
    {
      key: 'error',
      header: '错误信息',
      width: '200px',
      render: (t) =>
        t.errorMessage ? (
          <span className="block max-w-[200px] truncate text-xs text-red-400">{t.errorMessage}</span>
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
    </div>
  );
}
