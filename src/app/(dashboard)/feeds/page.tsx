'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { DataTable, Column } from '@/components/DataTable';
import { FeedDetail } from '@/components/FeedDetail';
import { ViolationDialog } from '@/components/ViolationDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Search, AlertTriangle } from 'lucide-react';

interface Feed {
  id: string;
  feedId: string;
  author: string;
  authorId: string;
  channelName: string;
  channelId: string;
  title: string;
  content: string;
  images?: string[];
  createdAt: string;
  likeCount: number;
  commentCount: number;
  status: string;
  comments?: Array<{
    id: string;
    author: string;
    content: string;
    createdAt: string;
    likeCount: number;
    replies?: Array<{
      id: string;
      author: string;
      content: string;
      createdAt: string;
      likeCount: number;
    }>;
  }>;
}

interface Channel {
  id: string;
  name: string;
}

interface FeedListResponse {
  data: Feed[];
  total: number;
  page: number;
  pageSize: number;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-50 text-green-600',
  deleted: 'bg-red-50 text-red-600',
  moved: 'bg-amber-50 text-amber-600',
};

const statusLabels: Record<string, string> = {
  active: '正常',
  deleted: '已删除',
  moved: '已移帖',
};

export default function FeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortField, setSortField] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [channels, setChannels] = useState<Channel[]>([]);

  const [selectedFeed, setSelectedFeed] = useState<Feed | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [violationOpen, setViolationOpen] = useState(false);
  const [violationTarget, setViolationTarget] = useState<{
    id: string;
    author: string;
    authorId: string;
  } | null>(null);

  const pageSize = 20;

  const fetchFeeds = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort: sortField,
        direction: sortDir,
      });
      if (search) params.set('search', search);
      if (channelFilter) params.set('channelId', channelFilter);
      if (statusFilter) params.set('status', statusFilter);

      const result = await api.get<FeedListResponse>(`/feeds?${params}`);
      setFeeds(result.data);
      setTotal(result.total);
    } catch {
      toast.error('获取帖子列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, search, channelFilter, statusFilter, sortField, sortDir]);

  useEffect(() => {
    fetchFeeds();
  }, [fetchFeeds]);

  useEffect(() => {
    api.get<Channel[]>('/channels').then(setChannels).catch(() => {});
  }, []);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(1);
  };

  const handleRowClick = (feed: Feed) => {
    setSelectedFeed(feed);
    setDetailOpen(true);
  };

  const handleViolation = (e: React.MouseEvent, feed: Feed) => {
    e.stopPropagation();
    setViolationTarget({ id: feed.feedId, author: feed.author, authorId: feed.authorId });
    setViolationOpen(true);
  };

  const columns: Column<Feed>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '100px',
      render: (f) => <span className="font-mono text-xs text-gray-500">{f.id.slice(0, 8)}</span>,
    },
    { key: 'author', header: '作者', width: '100px' },
    { key: 'channelName', header: '版块', width: '100px' },
    {
      key: 'title',
      header: '标题',
      render: (f) => (
        <span className="block max-w-[300px] truncate">{f.title || '(无标题)'}</span>
      ),
    },
    {
      key: 'createdAt',
      header: '时间',
      sortable: true,
      width: '160px',
      render: (f) => (
        <span className="text-xs text-gray-500">
          {new Date(f.createdAt).toLocaleString('zh-CN')}
        </span>
      ),
    },
    {
      key: 'likeCount',
      header: '👍',
      sortable: true,
      width: '60px',
      align: 'center',
      render: (f) => <span className="text-gray-700">{f.likeCount}</span>,
    },
    {
      key: 'commentCount',
      header: '💬',
      sortable: true,
      width: '60px',
      align: 'center',
      render: (f) => <span className="text-gray-700">{f.commentCount}</span>,
    },
    {
      key: 'status',
      header: '状态',
      width: '80px',
      render: (f) => (
        <Badge className={statusColors[f.status] || 'bg-gray-200 text-gray-700'}>
          {statusLabels[f.status] || f.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: '100px',
      align: 'center',
      render: (f) => (
        <Button
          variant="ghost"
          size="xs"
          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          onClick={(e) => handleViolation(e, f)}
        >
          <AlertTriangle className="size-3" />
          标记违规
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">帖子管理</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="搜索标题/作者..."
            className="w-60 pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <SelectValue placeholder="全部版块" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部版块</SelectItem>
            {channels.map((ch) => (
              <SelectItem key={ch.id} value={ch.id}>
                {ch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="active">正常</SelectItem>
            <SelectItem value="deleted">已删除</SelectItem>
            <SelectItem value="moved">已移帖</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={feeds}
        loading={loading}
        rowKey={(f) => f.id}
        onRowClick={handleRowClick}
        sort={{ field: sortField, direction: sortDir, onSort: handleSort }}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
        }}
      />

      {/* Feed Detail Dialog */}
      <FeedDetail feed={selectedFeed} open={detailOpen} onOpenChange={setDetailOpen} />

      {/* Violation Dialog */}
      {violationTarget && (
        <ViolationDialog
          open={violationOpen}
          onOpenChange={(open) => {
            setViolationOpen(open);
            if (!open) {
              setViolationTarget(null);
              fetchFeeds();
            }
          }}
          targetType="feed"
          targetId={violationTarget.id}
          targetAuthor={violationTarget.author}
          targetAuthorId={violationTarget.authorId}
        />
      )}
    </div>
  );
}
