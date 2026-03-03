import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import FilterBar from '../../components/FilterBar/FilterBar';
import type { FilterValues } from '../../components/FilterBar/FilterBar';
import EventTable from '../../components/EventTable/EventTable';
import EventDetail from '../../components/EventDetail/EventDetail';

interface DetectionEvent {
  id: string;
  cameraId: string;
  personId: string | null;
  personName: string;
  isKnown: boolean;
  direction: 'ENTER' | 'EXIT' | 'INSIDE' | null;
  detectionMethod: 'line_crossing' | 'heuristic' | null;
  confidence: number;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  snapshotPath: string | null;
  clipPath: string | null;
  telegramSent: boolean;
  telegramSentAt: string | null;
  createdAt: string;
  eventType?: string;
  journeyId?: string | null;
  zoneId?: string | null;
}

const PAGE_SIZE = 50;

export default function EventLog() {
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<DetectionEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [filters, setFilters] = useState<FilterValues>({});
  const offsetRef = useRef(0);

  // Fetch events with current filters
  const fetchEvents = useCallback(async (currentFilters: FilterValues, offset: number, append: boolean) => {
    if (offset === 0) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }

    try {
      if (window.electronAPI?.events?.list) {
        const result = await window.electronAPI.events.list({
          ...currentFilters,
          limit: PAGE_SIZE,
          offset,
        });

        const eventList = result as DetectionEvent[];
        if (append) {
          setEvents((prev) => [...prev, ...eventList]);
        } else {
          setEvents(eventList);
        }
        setHasMore(eventList.length >= PAGE_SIZE);
        offsetRef.current = offset + eventList.length;
      }
    } catch (error) {
      console.error('[EventLog] Failed to fetch events:', error);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  // Initial load and filter changes
  useEffect(() => {
    offsetRef.current = 0;
    fetchEvents(filters, 0, false);
  }, [filters, fetchEvents]);

  // Handle filter changes
  const handleFiltersChange = useCallback((newFilters: FilterValues) => {
    setFilters(newFilters);
    setSelectedEvent(null);
  }, []);

  // Load more (pagination)
  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchEvents(filters, offsetRef.current, true);
    }
  }, [filters, isLoadingMore, hasMore, fetchEvents]);

  // Refresh
  const handleRefresh = useCallback(() => {
    offsetRef.current = 0;
    fetchEvents(filters, 0, false);
  }, [filters, fetchEvents]);

  // Real-time event updates via IPC
  useEffect(() => {
    if (!window.electronAPI?.events?.onNew) return;

    const unsubscribe = window.electronAPI.events.onNew((data: unknown) => {
      const newEvent = data as DetectionEvent;
      setEvents((prev) => [newEvent, ...prev]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Keyboard: Escape to close detail
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedEvent) {
        setSelectedEvent(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEvent]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h1 className="text-lg font-semibold text-neutral-100">Event Log</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
            aria-label="Refresh events"
            title="Refresh"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="border-b border-neutral-800 px-4 py-2">
        <FilterBar onFiltersChange={handleFiltersChange} />
      </div>

      {/* Content: Table + Detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Event Table */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <EventTable
            events={events}
            onSelectEvent={setSelectedEvent}
            selectedEventId={selectedEvent?.id ?? null}
            isLoading={isLoading}
          />

          {/* Load More */}
          {hasMore && events.length > 0 && !isLoading && (
            <div className="border-t border-neutral-800 px-4 py-2 text-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="rounded-md px-4 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-40"
              >
                {isLoadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>

        {/* Event Detail Panel */}
        {selectedEvent && (
          <div className="w-80 shrink-0">
            <EventDetail
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
