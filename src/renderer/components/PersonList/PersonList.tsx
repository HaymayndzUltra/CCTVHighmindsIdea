import { UserPlus, User } from 'lucide-react';
import type { Person } from '../../../shared/types';

interface PersonListProps {
  persons: Person[];
  selectedPersonId: string | null;
  onSelectPerson: (person: Person) => void;
  onAddPerson: () => void;
  isLoading: boolean;
}

export default function PersonList({
  persons,
  selectedPersonId,
  onSelectPerson,
  onAddPerson,
  isLoading,
}: PersonListProps) {
  return (
    <div className="flex h-full w-72 flex-col border-r border-neutral-800 bg-neutral-900/50">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-200">
          Persons ({persons.length})
        </h2>
        <button
          onClick={onAddPerson}
          className="flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-neutral-900"
          aria-label="Add new person"
        >
          <UserPlus size={14} strokeWidth={2} />
          Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-neutral-800"
              />
            ))}
          </div>
        ) : persons.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-neutral-500">
            <User size={32} strokeWidth={1} />
            <p className="text-sm">No persons enrolled yet.</p>
            <p className="text-xs">Click "Add" to enroll a new person.</p>
          </div>
        ) : (
          <ul className="space-y-0.5 p-2" role="listbox" aria-label="Person list">
            {persons.map((person) => {
              const isSelected = person.id === selectedPersonId;
              return (
                <li key={person.id}>
                  <button
                    onClick={() => onSelectPerson(person)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? 'bg-primary-600/20 text-primary-300'
                        : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-700 text-sm font-medium text-neutral-300">
                      {person.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {person.name}
                        </span>
                        {!person.enabled && (
                          <span className="flex-shrink-0 rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                            Disabled
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-neutral-500">
                        {person.embeddingsCount} image{person.embeddingsCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
