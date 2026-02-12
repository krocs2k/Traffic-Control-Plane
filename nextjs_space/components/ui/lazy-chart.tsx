'use client';

import { Suspense, lazy, ComponentType } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

// Lazy load recharts components
const LazyLineChart = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.LineChart }))
);
const LazyAreaChart = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.AreaChart }))
);
const LazyBarChart = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.BarChart }))
);
const LazyPieChart = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.PieChart }))
);
const LazyResponsiveContainer = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.ResponsiveContainer }))
);

// Re-export commonly used recharts components for lazy loading
export { LazyLineChart, LazyAreaChart, LazyBarChart, LazyPieChart, LazyResponsiveContainer };

// Chart loading skeleton
export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <Skeleton className="w-full h-full" />
    </div>
  );
}

// Wrapper component for lazy-loaded charts
interface LazyChartWrapperProps {
  children: React.ReactNode;
  height?: number;
}

export function LazyChartWrapper({ children, height = 300 }: LazyChartWrapperProps) {
  return (
    <Suspense fallback={<ChartSkeleton height={height} />}>
      {children}
    </Suspense>
  );
}

// Higher-order component for lazy loading any component
export function withLazyLoading<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  fallback?: React.ReactNode
) {
  const LazyComponent = lazy(importFn);
  
  return function LazyWrapper(props: P) {
    return (
      <Suspense fallback={fallback || <Skeleton className="w-full h-32" />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}
