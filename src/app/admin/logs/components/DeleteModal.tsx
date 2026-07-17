interface DeleteModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  deletingIds: string[];
  error?: string | null;
  success?: boolean;
}

export const DeleteModal: React.FC<DeleteModalProps> = ({
  open,
  onClose,
  onConfirm,
  deletingIds,
  error,
  success,
}) => {
  if (!open && !success) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Overlay */}
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative w-full max-w-md bg-white rounded-lg shadow-xl">
          <div className="p-6">
            {success ? (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <svg
                    className="h-6 w-6 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h3 className="mt-4 text-center text-lg font-medium text-gray-900">
                  Успешно удалено
                </h3>
                <p className="mt-2 text-center text-sm text-gray-500">
                  Удалено записей: {deletingIds.length}
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-medium text-gray-900">
                  Удаление логов
                </h3>
                <p className="mt-2 text-sm text-gray-500">
                  Вы уверены, что хотите удалить <strong>{deletingIds.length}</strong>
                  {' '}
                  записей? Это действие нельзя отменить.
                </p>
              </>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Отмена
              </button>

              {!success && (
                <button
                  type="button"
                  onClick={onConfirm}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700"
                >
                  Удалить
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};