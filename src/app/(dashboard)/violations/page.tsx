'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { DataTable, Column } from '@/components/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Download, Trash2 } from 'lucide-react';

interface Violation {
  id: number;
  createdAt: string;
  targetType: string;
  targetId: string;
  targetFeedId?: string;
  targetCommentId?: string;
  targetReplyId?: string;
  targetAuthor: string;
  reason: string;
  actionType: string;
  actionDetail?: { movedToChannel?: string; muteDurationHours?: string } | null;
  violationDetail?: string | null;
  notified: boolean;
  notificationType?: string | null;
  notificationText?: string | null;
  operator: string;
  identityName: string;
}

interface ViolationListResponse {
  data: Violation[];
  total: number;
  page: number;
  pageSize: number;
}

const actionLabels: Record<string, string> = {
  move: '移帖',
  delete: '删帖',
  delete_comment: '删评论',
  delete_reply: '删评论',
  none: '未处理',
};

const actionColors: Record<string, string> = {
  move: 'bg-amber-50 text-amber-600',
  delete: 'bg-red-50 text-red-600',
  delete_comment: 'bg-orange-50 text-orange-600',
  delete_reply: 'bg-orange-50 text-orange-600',
  none: 'bg-gray-100 text-gray-500',
};

const targetTypeLabels: Record<string, string> = {
  feed: '帖子',
  comment: '评论',
  reply: '评论',
};

export default function ViolationsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [violations, setViolations] = useState<Violation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reasonFilter, setReasonFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  const [reasons, setReasons] = useState<string[]>([]);
  const [operators, setOperators] = useState<string[]>([]);

  const pageSize = 20;

  const fetchViolations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (reasonFilter) params.set('reason', reasonFilter);
      if (actionFilter) params.set('actionType', actionFilter);
      if (operatorFilter) params.set('operator', operatorFilter);

      const result = await api.get<ViolationListResponse>(`/violations?${params}`);
      setViolations(result.data);
      setTotal(result.total);
    } catch {
      toast.error('获取违规记录失败');
    } finally {
      setLoading(false);
    }
  }, [page, reasonFilter, actionFilter, operatorFilter]);

  useEffect(() => {
    fetchViolations();
  }, [fetchViolations]);

  useEffect(() => {
    api.get<{ reasons: string[]; operators: string[] }>('/violations/filters')
      .then((data) => {
        setReasons(data.reasons || []);
        setOperators(data.operators || []);
      })
      .catch(() => {});
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (reasonFilter) params.set('reason', reasonFilter);
      if (actionFilter) params.set('actionType', actionFilter);
      if (operatorFilter) params.set('operator', operatorFilter);

      // Auth via httpOnly cookie — credentials: 'include' required for fetch
      const res = await fetch(`/api/violations/export?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `违规记录_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('导出成功');
    } catch {
      toast.error('导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除这条违规记录吗？此操作不可撤销。')) return;
    try {
      await api.delete(`/violations/${id}`);
      toast.success('违规记录已删除');
      fetchViolations();
    } catch {
      toast.error('删除失败');
    }
  };

  const columns: Column<Violation>[] = [
    {
      key: 'createdAt',
      header: '时间',
      width: '160px',
      render: (v) => (
        <span className="text-xs text-gray-500">
          {new Date(v.createdAt).toLocaleString('zh-CN')}
        </span>
      ),
    },
    {
      key: 'targetType',
      header: '目标类型',
      width: '80px',
      render: (v) => (
        <span className="text-gray-700">{targetTypeLabels[v.targetType] || v.targetType}</span>
      ),
    },
    {
      key: 'targetId',
      header: '目标ID',
      width: '100px',
      render: (v) => (
        <span className="font-mono text-xs text-gray-500">{v.targetId.slice(0, 8)}</span>
      ),
    },
    { key: 'targetAuthor', header: '被处置者', width: '100px' },
    { key: 'reason', header: '违规原因', width: '140px' },
    {
      key: 'actionType',
      header: '处置方式',
      width: '110px',
      render: (v) => {
        const action = actionLabels[v.actionType] || v.actionType;
        const ad = v.actionDetail;
        const extras: string[] = [];
        if (ad?.muteDurationHours) extras.push(`禁言${ad.muteDurationHours}`);
        if (ad?.movedToChannel) extras.push(`→${ad.movedToChannel}`);
        const title = extras.length > 0 ? `${action}（${extras.join('，')}）` : action;
        return (
          <Badge className={actionColors[v.actionType] || 'bg-gray-200 text-gray-700'} title={title}>
            {title.length > 14 ? title.slice(0, 12) + '…' : title}
          </Badge>
        );
      },
    },
    {
      key: 'violationDetail',
      header: '补充说明',
      width: '130px',
      render: (v) => {
        const d = v.violationDetail;
        if (!d) return <span className="text-xs text-gray-300">-</span>;
        const short = d.length > 20 ? d.slice(0, 18) + '…' : d;
        return (
          <span className="text-xs text-gray-600 cursor-help" title={d}>
            {short}
          </span>
        );
      },
    },
    {
      key: 'notified',
      header: '通知',
      width: '75px',
      align: 'center',
      render: (v) => {
        if (!v.notified) return <span className="text-xs text-gray-400">未通知</span>;
        const typeLabel = v.notificationType === 'dm' ? '私信' : v.notificationType === 'reply' ? '评论' : '';
        const tip = [typeLabel, v.notificationText].filter(Boolean).join('：');
        return (
          <span className="text-xs text-green-500 cursor-help" title={tip}>
            已通知{typeLabel ? `(${typeLabel})` : ''}
          </span>
        );
      },
    },
    { key: 'operator', header: '操作人', width: '100px' },
    {
      key: 'identityName',
      header: '使用身份',
      width: '100px',
      render: (v) => (
        <span className="text-xs text-gray-500">{v.identityName || '-'}</span>
      ),
    },
    {
      key: 'actionType',
      header: '',
      width: '60px',
      align: 'center',
      render: (v) => {
        const fid = v.targetType === 'feed' ? v.targetId : v.targetFeedId;
        if (!fid) return null;
        return (
          <Button
            variant="ghost"
            size="xs"
            className="text-blue-500 hover:text-blue-700 hover:bg-blue-50 text-[11px] px-1.5 py-0"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/feeds?feedId=${fid}`);
            }}
          >
            查看
          </Button>
        );
      },
    },
  ];

  // Admin-only: delete button
  if (user?.role === 'admin') {
    columns.push({
      key: 'id' as const,
      header: '',
      width: '50px',
      align: 'center',
      render: (v) => (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-gray-400 hover:text-red-500 hover:bg-red-50"
          onClick={(e) => { e.stopPropagation(); handleDelete(v.id); }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">违规记录</h2>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
          <Download className="size-3.5" />
          {exporting ? '导出中...' : '导出 XLSX'}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={reasonFilter} onValueChange={(v) => { setReasonFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <span className="text-sm truncate max-w-[140px]">{reasonFilter || '全部原因'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部原因</SelectItem>
            {reasons.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <span className="text-sm">{{ '': '全部处置', move: '移帖', delete: '删帖', delete_comment: '删评论', delete_reply: '删评论', none: '未处理' }[actionFilter] || '全部处置'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部处置</SelectItem>
            <SelectItem value="move">移帖</SelectItem>
            <SelectItem value="delete">删帖</SelectItem>
            <SelectItem value="delete_comment">删评论</SelectItem>
            <SelectItem value="delete_reply">删回复</SelectItem>
            <SelectItem value="none">未处理</SelectItem>
          </SelectContent>
        </Select>
        <Select value={operatorFilter} onValueChange={(v) => { setOperatorFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <span className="text-sm truncate max-w-[140px]">{operatorFilter || '全部操作人'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部操作人</SelectItem>
            {operators.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={violations}
        loading={loading}
        rowKey={(v) => v.id}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
        }}
      />
    </div>
  );
}
