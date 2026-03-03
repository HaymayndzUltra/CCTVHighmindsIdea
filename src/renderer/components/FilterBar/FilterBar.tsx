import { useState, useEffect, useCallback } from 'react';
import { Filter, X } from 'lucide-react';

interface FilterBarProps {
  onFiltersChange: (filters: FilterValues) => void;
}

export interface FilterValues {
  cameraId?: string;
  personId?: string;
  isKnown?: boolean;
  direction?: 'ENTER' | 'EXIT' | 'INSIDE';
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface CameraOption {
  id: string;
  label: string;
}

interface PersonOption {
  id: string;
  name: string;
}

export default function FilterBar({ onFiltersChange }: FilterBarProps) {
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [persons, setPersons] = useState<PersonOption[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [personId, setPersonId] = useState('');
  const [knownFilter, setKnownFilter] = useState<'' | 'known' | 'unknown'>('');
  const [direction, setDirection] = useState('');
  const [eventType, setEventType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Load camera and person options
  useEffect(() => {
    let isMounted = true;

    async function loadOptions() {
      try {
        if (window.electronAPI?.camera?.list) {
          const cameraList = await window.electronAPI.camera.list();
          if (isMounted) {
            setCameras(cameraList.map((c) => ({ id: c.id, label: c.label })));
          }
        }
        if (window.electronAPI?.person?.list) {
          const personList = await window.electronAPI.person.list();
          if (isMounted) {
            setPersons(personList.map((p) => ({ id: p.id, name: p.name })));
          }
        }
      } catch (error) {
        console.error('[FilterBar] Failed to load filter options:', error);
      }
    }

    loadOptions();
    return () => { isMounted = false; };
  }, []);

  // Emit filter changes
  const applyFilters = useCallback(() => {
    const filters: FilterValues = {};
    if (cameraId) filters.cameraId = cameraId;
    if (personId) filters.personId = personId;
    if (knownFilter === 'known') filters.isKnown = true;
    if (knownFilter === 'unknown') filters.isKnown = false;
    if (direction) filters.direction = direction as 'ENTER' | 'EXIT' | 'INSIDE';
    if (eventType) filters.eventType = eventType;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;
    onFiltersChange(filters);
  }, [cameraId, personId, knownFilter, direction, eventType, dateFrom, dateTo, onFiltersChange]);

  // Auto-apply on filter change
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  const handleClear = useCallback(() => {
    setCameraId('');
    setPersonId('');
    setKnownFilter('');
    setDirection('');
    setEventType('');
    setDateFrom('');
    setDateTo('');
  }, []);

  const hasActiveFilters = cameraId || personId || knownFilter || direction || eventType || dateFrom || dateTo;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-400">
        <Filter size={14} />
        <span>Filters</span>
      </div>

      {/* Camera filter */}
      <select
        value={cameraId}
        onChange={(e) => setCameraId(e.target.value)}
        className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
        aria-label="Filter by camera"
      >
        <option value="">All Cameras</option>
        {cameras.map((cam) => (
          <option key={cam.id} value={cam.id}>
            {cam.id} — {cam.label}
          </option>
        ))}
      </select>

      {/* Person filter */}
      <select
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
        className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
        aria-label="Filter by person"
      >
        <option value="">All Persons</option>
        {persons.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {/* Known/Unknown toggle */}
      <select
        value={knownFilter}
        onChange={(e) => setKnownFilter(e.target.value as '' | 'known' | 'unknown')}
        className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
        aria-label="Filter by known status"
      >
        <option value="">All</option>
        <option value="known">Known</option>
        <option value="unknown">Unknown</option>
      </select>

      {/* Event type filter */}
      <select
        value={eventType}
        onChange={(e) => setEventType(e.target.value)}
        className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
        aria-label="Filter by event type"
      >
        <option value="">All Types</option>
        <option value="detection">Detection</option>
        <option value="journey">Journey</option>
        <option value="presence_change">Presence Change</option>
        <option value="zone_enter">Zone Enter</option>
        <option value="zone_exit">Zone Exit</option>
        <option value="loiter">Loiter</option>
        <option value="behavior">Behavior</option>
        <option value="sound">Sound</option>
      </select>

      {/* Direction filter */}
      <select
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
        aria-label="Filter by direction"
      >
        <option value="">Any Direction</option>
        <option value="ENTER">Enter</option>
        <option value="EXIT">Exit</option>
        <option value="INSIDE">Inside</option>
      </select>

      {/* Date range */}
      <input
        type="date"
        value={dateFrom}
        onChange={(e) => setDateFrom(e.target.value)}
        className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
        aria-label="Date from"
        title="Date from"
      />
      <span className="text-xs text-neutral-500">to</span>
      <input
        type="date"
        value={dateTo}
        onChange={(e) => setDateTo(e.target.value)}
        className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 outline-none transition-colors focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30"
        aria-label="Date to"
        title="Date to"
      />

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={handleClear}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          aria-label="Clear all filters"
          title="Clear all filters"
        >
          <X size={12} />
          <span>Clear</span>
        </button>
      )}
    </div>
  );
}
