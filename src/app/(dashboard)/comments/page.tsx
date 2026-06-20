'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { DataTable, Column } from '@/components/DataTable';
import { ViolationDialog } from '@/components/ViolationDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Search, AlertTriangle, ThumbsUp } from 'lucide-react';

interface Comment {
  id: string;
  feedId: string;
  feedTitle: string;
  author: string;
  authorId: string;
  content: string;
  createdAt: string;
  likeCount: number;
  status: string;
}

interface CommentListResponse {
  data: Comment[];
  total: number;
  page: number;
  pageSize: number;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-50 text-green-600',
  deleted: 'bg-red-50 text-red-600',
};

const statusLabels: Record<string, string> = {
  active: '正常',
  deleted: '已删除',
};

export default function CommentsPage() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [selectedComment, setSelectedComment] = useState<Comment | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [violationOpen, setViolationOpen] = useState(false);
  const [violationTarget, setViolationTarget] = useState<{
    id: string;
    author: string;
    authorId: string;
    feedId: string;
  } | null>(null);

  const pageSize = 20;

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const result = await api.get<CommentListResponse>(`/comments?${params}`);
      setComments(result.data);
      setTotal(result.total);
    } catch {
      toast.error('获取评论列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleRowClick = (comment: Comment) => {
    setSelectedComment(comment);
    setDetailOpen(true);
  };

  const handleViolation = (e: React.MouseEvent, comment: Comment) => {
    e.stopPropagation();
    setViolationTarget({
      id: comment.id,
      author: comment.author,
      authorId: comment.authorId,
      feedId: comment.feedId,
    });
    setViolationOpen(true);
  };

  const columns: Column<Comment>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '100px',
      render: (c) => <span className="font-mono text-xs text-gray-500">{c.id.slice(0, 8)}</span>,
    },
    {
      key: 'feedTitle',
      header: '所属帖子',
      width: '160px',
      render: (c) => (
        <span className="block max-w-[160px] truncate text-gray-700">{c.feedTitle}</span>
      ),
    },
    { key: 'author', header: '作者', width: '100px' },
    {
      key: 'content',
      header: '内容',
      render: (c) => (
        <span className="block max-w-[400px] truncate text-gray-700">{c.content}</span>
      ),
    },
    {
      key: 'createdAt',
      header: '时间',
      width: '160px',
      render: (c) => (
        <span className="text-xs text-gray-500">
          {new Date(c.createdAt).toLocaleString('zh-CN')}
        </span>
      ),
    },
    {
      key: 'likeCount',
      header: '👍',
      width: '60px',
      align: 'center',
      render: (c) => <span className="text-gray-700">{c.likeCount}</span>,
    },
    {
      key: 'status',
      header: '状态',
      width: '80px',
      render: (c) => (
        <Badge className={statusColors[c.status] || 'bg-gray-200 text-gray-700'}>
          {statusLabels[c.status] || c.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: '100px',
      align: 'center',
      render: (c) => (
        <Button
          variant="ghost"
          size="xs"
          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          onClick={(e) => handleViolation(e, c)}
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
        <h2 className="text-lg font-semibold text-gray-900">评论管理</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="搜索内容/作者..."
            className="w-60 pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="active">正常</SelectItem>
            <SelectItem value="deleted">已删除</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={comments}
        loading={loading}
        rowKey={(c) => c.id}
        onRowClick={handleRowClick}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
        }}
      />

      {/* Comment Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>评论详情</DialogTitle>
          </DialogHeader>
          {selectedComment && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-900">{selectedComment.author}</span>
                  <span>·</span>
                  <span>{new Date(selectedComment.createdAt).toLocaleString('zh-CN')}</span>
                  <span className="flex items-center gap-0.5">
                    <ThumbsUp className="size-3" />
                    {selectedComment.likeCount}
                  </span>
                </div>
                <div className="rounded-lg bg-gray-100 p-3">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedComment.content}</p>
                </div>
                <div className="text-xs text-gray-400">
                  所属帖子: <span className="text-gray-700">{selectedComment.feedTitle}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={statusColors[selectedComment.status] || 'bg-gray-200 text-gray-700'}>
                    {statusLabels[selectedComment.status] || selectedComment.status}
                  </Badge>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Violation Dialog */}
      {violationTarget && (
        <ViolationDialog
          open={violationOpen}
          onOpenChange={(open) => {
            setViolationOpen(open);
            if (!open) {
              setViolationTarget(null);
              fetchComments();
            }
          }}
          targetType="comment"
          targetId={violationTarget.id}
          targetAuthor={violationTarget.author}
          targetAuthorId={violationTarget.authorId}
          targetFeedId={violationTarget.feedId}
        />
      )}
    </div>
  );
}
