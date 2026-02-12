'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export interface PaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UsePaginationOptions<T> {
  initialLimit?: number;
  fetchFn: (page: number, limit: number) => Promise<{ data: T[]; pagination: PaginationState }>;
  deps?: unknown[];
}

export interface UsePaginationReturn<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  pagination: PaginationState;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  refresh: () => void;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextPage: () => void;
  prevPage: () => void;
}

export function usePagination<T>({
  initialLimit = 20,
  fetchFn,
  deps = [],
}: UsePaginationOptions<T>): UsePaginationReturn<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: initialLimit,
    total: 0,
    totalPages: 0,
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (page: number, limit: number) => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await fetchFn(page, limit);
      setData(result.data);
      setPagination(result.pagination);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    fetchData(pagination.page, pagination.limit);
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.limit, ...deps]);

  const setPage = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, page }));
  }, []);

  const setLimit = useCallback((limit: number) => {
    setPagination(prev => ({ ...prev, page: 1, limit }));
  }, []);

  const refresh = useCallback(() => {
    fetchData(pagination.page, pagination.limit);
  }, [fetchData, pagination.page, pagination.limit]);

  return {
    data,
    loading,
    error,
    pagination,
    setPage,
    setLimit,
    refresh,
    hasNextPage: pagination.page < pagination.totalPages,
    hasPrevPage: pagination.page > 1,
    nextPage: () => setPage(pagination.page + 1),
    prevPage: () => setPage(pagination.page - 1),
  };
}

// Infinite scroll hook
export interface UseInfiniteScrollOptions<T> {
  initialLimit?: number;
  fetchFn: (page: number, limit: number) => Promise<{ data: T[]; pagination: PaginationState }>;
  deps?: unknown[];
}

export function useInfiniteScroll<T>({
  initialLimit = 20,
  fetchFn,
  deps = [],
}: UseInfiniteScrollOptions<T>) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn(1, initialLimit);
      setData(result.data);
      setPage(1);
      setTotal(result.pagination.total);
      setHasMore(result.pagination.page < result.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [fetchFn, initialLimit]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const result = await fetchFn(nextPage, initialLimit);
      setData(prev => [...prev, ...result.data]);
      setPage(nextPage);
      setHasMore(result.pagination.page < result.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchFn, initialLimit, page, hasMore, loadingMore]);

  useEffect(() => {
    fetchInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    loading,
    loadingMore,
    error,
    hasMore,
    total,
    loadMore,
    refresh: fetchInitial,
  };
}
