'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ThumbsUp, MessageCircle, Clock, AlertTriangle, CornerDownRight, X } from 'lucide-react';

interface Reply {
  id: string;
  replyId: string;
  author: string;
  authorId: string;
  content: string;
  contentImages?: string[];
  createdAt: string;
  likeCount: number;
  status: string;
  targetReplyId?: string | null;
  targetUser?: string | null;
}

interface Comment {
  id: string;
  commentId: string;
  author: string;
  authorId: string;
  feedId: string;
  content: string;
  contentImages?: string[];
  createdAt: string;
  likeCount: number;
  status: string;
  replies?: Reply[];
}

interface Feed {
  id: string;
  feedId: string;
  author: string;
  authorId: string;
  channelName: string;
  title: string;
  content: string;
  images?: string[];
  createdAt: string;
  likeCount: number;
  commentCount: number;
  status: string;
  comments?: Comment[];
}

interface FeedDetailProps {
  feed: Feed | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViolationFeed?: (feedId: string, author: string, authorId: string) => void;
  onViolationComment?: (commentId: string, author: string, authorId: string, feedId: string) => void;
  onViolationReply?: (replyId: string, author: string, authorId: string, feedId: string) => void;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('zh-CN');
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

function ImgWithPreview({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        className={`cursor-pointer ${className || ''}`}
        onClick={() => setOpen(true)}
      />
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setOpen(false)}
          >
            <X className="size-8" />
          </button>
          <img
            src={src}
            alt={alt}
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[90vh] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function ViolationButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={`text-amber-500 hover:text-amber-700 hover:bg-amber-50 ${className || ''}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <AlertTriangle className="size-3" />
      违规
    </Button>
  );
}

function ReplyItem({
  reply,
  depth,
  feedId,
  onViolation,
}: {
  reply: Reply;
  depth: number;
  feedId: string;
  onViolation?: (replyId: string, author: string, authorId: string, feedId: string) => void;
}) {
  return (
    <div className={`${depth > 0 ? 'ml-5 border-l-2 border-gray-100 pl-4' : 'ml-5 pl-3 border-l-2 border-blue-100'}`}>
      <div className="py-2.5 group">
        <div className="flex items-center gap-2 text-xs">
          <CornerDownRight className="size-3 text-gray-300 shrink-0" />
          <span className="font-medium text-gray-900">{reply.author}</span>
          {reply.targetUser && (
            <span className="text-blue-500">
              回复 <span className="font-medium">@{reply.targetUser}</span>
            </span>
          )}
          <span className="text-gray-400">{formatTime(reply.createdAt)}</span>
          <span className="flex items-center gap-0.5 text-gray-400">
            <ThumbsUp className="size-3" />
            {reply.likeCount}
          </span>
          {reply.status === 'deleted' && (
            <Badge className="bg-red-50 text-red-500 text-[10px] px-1.5 py-0">已删除</Badge>
          )}
          <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            {onViolation && (
              <ViolationButton onClick={() => onViolation(reply.replyId, reply.author, reply.authorId, feedId)} />
            )}
          </span>
        </div>
        <p className={`mt-1 text-sm whitespace-pre-wrap ${reply.status === 'deleted' ? 'text-gray-400 italic' : 'text-gray-700'}`}>
          {reply.status === 'deleted' ? '(此评论已被删除)' : reply.content}
        </p>
        {reply.status !== 'deleted' && reply.contentImages && reply.contentImages.length > 0 && (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {reply.contentImages.map((img, i) => (
              <ImgWithPreview
                key={i}
                src={img}
                alt={`图片 ${i + 1}`}
                className="size-16 rounded-lg object-cover ring-1 ring-gray-200"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  onViolationComment,
  onViolationReply,
}: {
  comment: Comment;
  onViolationComment?: (commentId: string, author: string, authorId: string, feedId: string) => void;
  onViolationReply?: (replyId: string, author: string, authorId: string, feedId: string) => void;
}) {
  return (
    <div className="py-3 group">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-gray-900">{comment.author}</span>
        <span className="text-gray-400">{formatTime(comment.createdAt)}</span>
        <span className="flex items-center gap-0.5 text-gray-400">
          <ThumbsUp className="size-3" />
          {comment.likeCount}
        </span>
        {comment.status === 'deleted' && (
          <Badge className="bg-red-50 text-red-500 text-[10px] px-1.5 py-0">已删除</Badge>
        )}
        <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {onViolationComment && (
            <ViolationButton onClick={() => onViolationComment(comment.commentId, comment.author, comment.authorId, comment.feedId)} />
          )}
        </span>
      </div>
      <p className={`mt-1.5 text-sm whitespace-pre-wrap ${comment.status === 'deleted' ? 'text-gray-400 italic' : 'text-gray-700'}`}>
        {comment.status === 'deleted' ? '(此评论已被删除)' : comment.content}
      </p>
      {comment.status !== 'deleted' && comment.contentImages && comment.contentImages.length > 0 && (
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {comment.contentImages.map((img, i) => (
            <ImgWithPreview
              key={i}
              src={img}
              alt={`图片 ${i + 1}`}
              className="size-16 rounded-lg object-cover ring-1 ring-gray-200"
            />
          ))}
        </div>
      )}
      {/* Nested replies (层中层) */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-2 space-y-0">
          {comment.replies.map((reply, idx) => (
            <ReplyItem
              key={reply.id}
              reply={reply}
              depth={idx > 0 ? 1 : 0}
              feedId={comment.feedId}
              onViolation={onViolationReply}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FeedDetail({
  feed,
  open,
  onOpenChange,
  onViolationFeed,
  onViolationComment,
  onViolationReply,
}: FeedDetailProps) {
  if (!feed) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">{feed.title || '(无标题)'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 -mx-4 px-4">
          <div className="space-y-4">
            {/* Meta */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="font-medium text-gray-900">{feed.author}</span>
              <span>·</span>
              <span>{feed.channelName}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatTime(feed.createdAt)}
              </span>
              <Badge className={statusColors[feed.status] || 'bg-gray-200 text-gray-700'}>
                {statusLabels[feed.status] || feed.status}
              </Badge>
              {onViolationFeed && feed.status !== 'deleted' && (
                <span className="ml-auto">
                  <ViolationButton onClick={() => onViolationFeed(feed.feedId, feed.author, feed.authorId)} />
                </span>
              )}
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <ThumbsUp className="size-3.5" />
                {feed.likeCount}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="size-3.5" />
                {feed.commentCount}
              </span>
            </div>

            {/* Content */}
            {feed.content && (
              <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-100">
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{feed.content}</p>
              </div>
            )}

            {/* Images */}
            {feed.images && feed.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {feed.images.map((img, i) => (
                  <ImgWithPreview
                    key={i}
                    src={img}
                    alt={`图片 ${i + 1}`}
                    className="aspect-square rounded-lg object-cover ring-1 ring-gray-200"
                  />
                ))}
              </div>
            )}

            <Separator className="bg-gray-200" />

            {/* Comments */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-700">
                评论 ({feed.commentCount})
              </h3>
              {feed.comments && feed.comments.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {feed.comments.map((comment) => (
                    <CommentItem
                      key={comment.id}
                      comment={comment}
                      onViolationComment={onViolationComment}
                      onViolationReply={onViolationReply}
                    />
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-gray-400">暂无评论</p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
