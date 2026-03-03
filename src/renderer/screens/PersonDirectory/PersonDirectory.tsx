import { useState, useEffect, useCallback } from 'react';
import { Users } from 'lucide-react';
import PersonList from '../../components/PersonList/PersonList';
import PersonDetail from '../../components/PersonDetail/PersonDetail';
import EnrollmentModal from '../../components/EnrollmentModal/EnrollmentModal';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal/ConfirmDeleteModal';
import type { Person } from '../../../shared/types';

export default function PersonDirectory() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
  const [personToDelete, setPersonToDelete] = useState<Person | null>(null);

  const loadPersons = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.electronAPI.person.list();
      setPersons(result);
    } catch (err) {
      console.error('[PersonDirectory] Failed to load persons:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPersons();
  }, [loadPersons]);

  const handleSelectPerson = useCallback((person: Person) => {
    setSelectedPerson(person);
  }, []);

  const handleToggle = useCallback(
    async (personId: string, enabled: boolean) => {
      try {
        await window.electronAPI.person.toggle(personId, enabled);
        await loadPersons();
        setSelectedPerson((prev) =>
          prev && prev.id === personId ? { ...prev, enabled } : prev
        );
      } catch (err) {
        console.error('[PersonDirectory] Failed to toggle person:', err);
      }
    },
    [loadPersons]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!personToDelete) return;

    try {
      await window.electronAPI.person.delete(personToDelete.id);
      setPersonToDelete(null);
      if (selectedPerson?.id === personToDelete.id) {
        setSelectedPerson(null);
      }
      await loadPersons();
    } catch (err) {
      console.error('[PersonDirectory] Failed to delete person:', err);
    }
  }, [personToDelete, selectedPerson, loadPersons]);

  const handleEnroll = useCallback(
    async (data: {
      personName: string;
      label?: string;
      imageData: string[];
      source: 'upload' | 'capture' | 'event';
    }) => {
      const result = await window.electronAPI.person.enroll({
        personName: data.personName,
        label: data.label,
        imageData: data.imageData,
        source: data.source,
      });

      if (result.success) {
        await loadPersons();
      }

      return result;
    },
    [loadPersons]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-full">
        <PersonList
          persons={persons}
          selectedPersonId={selectedPerson?.id ?? null}
          onSelectPerson={handleSelectPerson}
          onAddPerson={() => setIsEnrollModalOpen(true)}
          isLoading={isLoading}
        />

        <div className="flex-1">
          {selectedPerson ? (
            <PersonDetail
              person={selectedPerson}
              onDelete={(id) => {
                const p = persons.find((pp) => pp.id === id);
                if (p) setPersonToDelete(p);
              }}
              onToggle={handleToggle}
              onRequestDelete={(p) => setPersonToDelete(p)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
              <Users size={40} strokeWidth={1} />
              <p className="text-sm">Select a person to view details</p>
            </div>
          )}
        </div>
      </div>

      <EnrollmentModal
        isOpen={isEnrollModalOpen}
        onClose={() => setIsEnrollModalOpen(false)}
        onEnroll={handleEnroll}
      />

      <ConfirmDeleteModal
        isOpen={personToDelete !== null}
        personName={personToDelete?.name ?? ''}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPersonToDelete(null)}
      />
    </div>
  );
}
